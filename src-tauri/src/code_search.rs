use ast_grep_config::{DeserializeEnv, RuleCore, SerializableRuleCore};
use ast_grep_core::tree_sitter::LanguageExt;
use ast_grep_language::{Language, SupportLang};
use ignore::types::{Types, TypesBuilder};
use ignore::{WalkBuilder, WalkState};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

use crate::{FileSearchResult, MAX_FILE_SEARCH_LIMIT};

const MAX_AST_SEARCH_FILE_BYTES: u64 = 1_048_576;
const AST_REFERENCE_CONTEXT_LINES: usize = 2;
const SUPPORTED_AST_LANGUAGES: &[SupportLang] = &[
    SupportLang::Go,
    SupportLang::Html,
    SupportLang::JavaScript,
    SupportLang::Rust,
    SupportLang::TypeScript,
    SupportLang::Tsx,
];
const JAVASCRIPT_AST_LANGUAGES: &[SupportLang] = &[
    SupportLang::Html,
    SupportLang::JavaScript,
    SupportLang::TypeScript,
    SupportLang::Tsx,
];

static AST_SEARCH_GENERATIONS: LazyLock<Mutex<HashMap<String, Arc<AtomicU64>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub(crate) fn search_symbol_references_in_root(
    root: &Path,
    query: &str,
    limit: usize,
    current_file_path: Option<&str>,
) -> Result<Vec<FileSearchResult>, String> {
    let symbol = normalize_symbol_query(query)?;
    let limit = limit.clamp(1, MAX_FILE_SEARCH_LIMIT);
    let root = root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve project root: {error}"))?;
    let (search_generation, generation) = next_search_generation(&root);
    let results = Arc::new(Mutex::new(Vec::new()));
    let result_count = Arc::new(AtomicUsize::new(0));

    for lang in search_languages_for_path(current_file_path) {
        if search_generation.load(Ordering::Acquire) != generation
            || result_count.load(Ordering::Acquire) >= limit
        {
            break;
        }
        let finder = find_in_files_impl(
            *lang,
            AstGrepFindConfig {
                paths: vec![root.clone()],
                matcher: AstGrepRuleConfig::reference_calls(*lang, &symbol),
                language_globs: None,
            },
        )?;
        finder.run(AstGrepSearchContext {
            root: &root,
            search_generation: &search_generation,
            generation,
            results: &results,
            result_count: &result_count,
            limit,
        });
    }

    let mut results = take_results(results)?;

    results.sort_by(|left, right| {
        left.path
            .cmp(&right.path)
            .then_with(|| left.line_number.cmp(&right.line_number))
            .then_with(|| left.match_ranges.cmp(&right.match_ranges))
    });
    results.dedup_by(|left, right| {
        left.path == right.path
            && left.line_number == right.line_number
            && left.match_ranges == right.match_ranges
    });
    results.truncate(limit);
    Ok(results)
}

fn next_search_generation(root: &Path) -> (Arc<AtomicU64>, u64) {
    let key = root.to_string_lossy().into_owned();
    let counter = {
        let mut generations = AST_SEARCH_GENERATIONS
            .lock()
            .expect("ast search generation lock should not be poisoned");
        Arc::clone(
            generations
                .entry(key)
                .or_insert_with(|| Arc::new(AtomicU64::new(0))),
        )
    };
    let generation = counter.fetch_add(1, Ordering::AcqRel) + 1;
    (counter, generation)
}

fn search_languages_for_path(current_file_path: Option<&str>) -> &'static [SupportLang] {
    let Some(path) = current_file_path else {
        return SUPPORTED_AST_LANGUAGES;
    };
    match supported_language_for_path(Path::new(path)) {
        Some(SupportLang::Go) => &[SupportLang::Go],
        Some(SupportLang::Rust) => &[SupportLang::Rust],
        Some(SupportLang::Html)
        | Some(SupportLang::JavaScript)
        | Some(SupportLang::TypeScript)
        | Some(SupportLang::Tsx) => JAVASCRIPT_AST_LANGUAGES,
        _ => SUPPORTED_AST_LANGUAGES,
    }
}

struct AstGrepFindConfig {
    paths: Vec<PathBuf>,
    matcher: AstGrepRuleConfig,
    language_globs: Option<Vec<String>>,
}

struct AstGrepFindInFiles {
    walk: ignore::WalkParallel,
    lang: SupportLang,
    rule: RuleCore,
}

struct AstGrepSearchContext<'a> {
    root: &'a Path,
    search_generation: &'a Arc<AtomicU64>,
    generation: u64,
    results: &'a Mutex<Vec<FileSearchResult>>,
    result_count: &'a AtomicUsize,
    limit: usize,
}

struct AstGrepFileRoot {
    path: String,
    content: String,
}

fn find_in_files_impl(
    lang: SupportLang,
    config: AstGrepFindConfig,
) -> Result<AstGrepFindInFiles, String> {
    let AstGrepFindConfig {
        paths,
        matcher,
        language_globs,
    } = config;
    let rule = matcher.parse_with(lang)?;
    let walk = find_files_with_lang(lang, paths, language_globs)?;
    Ok(AstGrepFindInFiles { walk, lang, rule })
}

impl AstGrepFindInFiles {
    fn run(self, context: AstGrepSearchContext<'_>) {
        let lang = self.lang;
        let rule = Arc::new(self.rule);
        let root = context.root.to_path_buf();
        let search_generation = Arc::clone(context.search_generation);
        let generation = context.generation;
        let results = context.results;
        let result_count = context.result_count;
        let limit = context.limit;

        self.walk.run(|| {
            let root = root.clone();
            let rule = Arc::clone(&rule);
            let search_generation = Arc::clone(&search_generation);

            Box::new(move |entry| {
                if search_generation.load(Ordering::Acquire) != generation
                    || result_count.load(Ordering::Acquire) >= limit
                {
                    return WalkState::Quit;
                }

                let remaining = limit.saturating_sub(result_count.load(Ordering::Acquire));
                if remaining == 0 {
                    return WalkState::Quit;
                }

                let matches = call_sg_node(lang, rule.as_ref(), entry, &root, remaining);
                if matches.is_empty() {
                    return WalkState::Continue;
                }

                append_results(results, result_count, matches, limit);
                if result_count.load(Ordering::Acquire) >= limit {
                    WalkState::Quit
                } else {
                    WalkState::Continue
                }
            })
        });
    }
}

fn find_files_with_lang(
    lang: SupportLang,
    paths: Vec<PathBuf>,
    language_globs: Option<Vec<String>>,
) -> Result<ignore::WalkParallel, String> {
    if paths.is_empty() {
        return Err("paths cannot be empty.".to_string());
    }

    let mut types = TypesBuilder::new();
    let type_name = lang.to_string();
    let custom_file_type = language_globs.unwrap_or_default();
    let default_types = lang.file_types();
    let types = select_custom(&mut types, &type_name, &default_types, &custom_file_type)
        .build()
        .map_err(|error| format!("Failed to build ast-grep file type filters: {error}"))?;

    let mut paths = paths.into_iter();
    let mut builder = WalkBuilder::new(paths.next().expect("paths checked above"));
    for path in paths {
        builder.add(path);
    }
    builder
        .types(types)
        .hidden(false)
        .parents(true)
        .ignore(true)
        .git_ignore(true)
        .git_exclude(true)
        .git_global(true)
        .require_git(false)
        .max_filesize(Some(MAX_AST_SEARCH_FILE_BYTES))
        .filter_entry(|entry| !is_expensive_directory(entry.path()));
    Ok(builder.build_parallel())
}

fn select_custom<'builder>(
    builder: &'builder mut TypesBuilder,
    file_type: &str,
    default_types: &Types,
    custom_suffix_list: &[String],
) -> &'builder mut TypesBuilder {
    add_types(builder, default_types);
    for suffix in custom_suffix_list {
        builder
            .add(file_type, suffix)
            .expect("file pattern must compile");
    }
    builder.select(file_type)
}

fn add_types(builder: &mut TypesBuilder, types: &Types) {
    for definition in types.definitions() {
        let name = definition.name();
        for glob in definition.globs() {
            builder.add(name, glob).expect(name);
        }
    }
}

fn call_sg_node(
    lang: SupportLang,
    rule: &RuleCore,
    entry: Result<ignore::DirEntry, ignore::Error>,
    root: &Path,
    limit: usize,
) -> Vec<FileSearchResult> {
    let Ok(entry) = entry else {
        return Vec::new();
    };
    if !entry
        .file_type()
        .map(|file_type| file_type.is_file())
        .unwrap_or(false)
    {
        return Vec::new();
    }
    let Some(file) = get_root(entry, lang, root) else {
        return Vec::new();
    };
    find_matches(&file.path, &file.content, lang, rule, limit)
}

fn get_root(entry: ignore::DirEntry, lang: SupportLang, root: &Path) -> Option<AstGrepFileRoot> {
    let path = entry.into_path();
    if supported_language_for_path(&path) != Some(lang) || !is_searchable_file(&path) {
        return None;
    }
    let content = fs::read_to_string(&path).ok()?;
    let path = relative_repo_path(root, &path)?;
    Some(AstGrepFileRoot { path, content })
}

fn find_matches(
    path: &str,
    content: &str,
    lang: SupportLang,
    rule: &RuleCore,
    limit: usize,
) -> Vec<FileSearchResult> {
    let root = lang.ast_grep(content);
    let line_starts = line_starts(content);
    let mut results = Vec::new();
    let mut seen_ranges = HashSet::new();

    for matched in root.root().find_all(rule) {
        if results.len() >= limit {
            return results;
        }
        let Some(method) = matched.get_env().get_match("METHOD") else {
            continue;
        };
        let range = method.range();
        if !seen_ranges.insert((range.start, range.end)) {
            continue;
        }
        let line_index = line_index_for_offset(&line_starts, range.start);
        let line_start = line_starts[line_index];
        let line_text = line_text_at(content, &line_starts, line_index);
        let match_start = range.start.saturating_sub(line_start) as u32;
        let match_end = range.end.saturating_sub(line_start) as u32;

        results.push(FileSearchResult {
            path: path.to_string(),
            score: 0,
            line_number: Some(line_index + 1),
            line_text: Some(line_text),
            context_before: context_before(content, &line_starts, line_index),
            context_after: context_after(content, &line_starts, line_index),
            match_ranges: vec![(match_start, match_end)],
        });
    }

    results
}

fn is_expensive_directory(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| {
            matches!(
                name,
                ".git"
                    | ".hg"
                    | ".svn"
                    | "node_modules"
                    | "dist"
                    | "build"
                    | "target"
                    | ".next"
                    | ".turbo"
                    | ".vite"
                    | ".cache"
            )
        })
        .unwrap_or(false)
}

fn relative_repo_path(root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
}

fn append_results(
    results: &Mutex<Vec<FileSearchResult>>,
    result_count: &AtomicUsize,
    mut matches: Vec<FileSearchResult>,
    limit: usize,
) {
    let Ok(mut results) = results.lock() else {
        return;
    };
    let remaining = limit.saturating_sub(results.len());
    let take = remaining.min(matches.len());
    results.extend(matches.drain(..take));
    result_count.store(results.len(), Ordering::Release);
}

fn take_results(
    results: Arc<Mutex<Vec<FileSearchResult>>>,
) -> Result<Vec<FileSearchResult>, String> {
    let mut results = results
        .lock()
        .map_err(|_| "Failed to collect ast-grep search results".to_string())?;
    Ok(std::mem::take(&mut *results))
}

struct AstGrepRuleConfig {
    rule: serde_json::Value,
    constraints: Option<serde_json::Value>,
    transform: Option<serde_json::Value>,
    utils: Option<serde_json::Value>,
}

impl AstGrepRuleConfig {
    fn reference_calls(lang: SupportLang, symbol: &str) -> Self {
        let method_regex = format!("^{}$", regex_escape_literal(symbol));
        let any = reference_call_patterns(lang)
            .iter()
            .map(|pattern| json!({ "pattern": pattern }))
            .collect::<Vec<_>>();
        Self {
            rule: json!({ "any": any }),
            constraints: Some(json!({
                "METHOD": {
                    "regex": method_regex,
                },
            })),
            transform: None,
            utils: None,
        }
    }

    fn parse_with(self, lang: SupportLang) -> Result<RuleCore, String> {
        let rule = SerializableRuleCore {
            rule: serde_json::from_value(self.rule).map_err(|error| error.to_string())?,
            constraints: self
                .constraints
                .map(serde_json::from_value)
                .transpose()
                .map_err(|error| error.to_string())?,
            transform: self
                .transform
                .map(serde_json::from_value)
                .transpose()
                .map_err(|error| error.to_string())?,
            utils: self
                .utils
                .map(serde_json::from_value)
                .transpose()
                .map_err(|error| error.to_string())?,
        };

        rule.get_matcher(DeserializeEnv::new(lang))
            .map_err(|error| error.to_string())
    }
}

fn reference_call_patterns(lang: SupportLang) -> &'static [&'static str] {
    match lang {
        SupportLang::Html => &[
            "<$METHOD $$$ATTRS></$METHOD>",
            "<$METHOD $$$ATTRS />",
            "<$METHOD>",
        ],
        SupportLang::Rust => &[
            "$RECEIVER::$METHOD($$$ARGS)",
            "$RECEIVER.$METHOD($$$ARGS)",
            "$METHOD($$$ARGS)",
        ],
        SupportLang::Go => &[
            "$RECEIVER.$METHOD()",
            "$RECEIVER.$METHOD($ARG, $$$REST)",
            "$METHOD($$$ARGS)",
        ],
        SupportLang::JavaScript | SupportLang::TypeScript | SupportLang::Tsx => {
            &["$RECEIVER.$METHOD($$$ARGS)", "$METHOD($$$ARGS)"]
        }
        _ => &[],
    }
}

fn regex_escape_literal(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        if matches!(
            ch,
            '.' | '+' | '*' | '?' | '^' | '$' | '(' | ')' | '[' | ']' | '{' | '}' | '|' | '\\'
        ) {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    escaped
}

fn normalize_symbol_query(query: &str) -> Result<String, String> {
    let mut symbol = query.trim();
    if let Some((before_paren, _)) = symbol.split_once('(') {
        symbol = before_paren.trim();
    }
    let symbol = symbol
        .rsplit(['.', ':', '#'])
        .find(|part| !part.is_empty())
        .unwrap_or(symbol)
        .trim()
        .strip_prefix("r#")
        .unwrap_or(symbol.trim());

    if symbol.is_empty() {
        return Err("Symbol name is required".to_string());
    }
    if symbol.len() > 128 {
        return Err("Symbol name is too long".to_string());
    }
    if !is_supported_symbol(symbol) {
        return Err("Symbol name must be an identifier".to_string());
    }
    Ok(symbol.to_string())
}

fn is_supported_symbol(symbol: &str) -> bool {
    let mut chars = symbol.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first == '_' || first == '$' || first.is_ascii_alphabetic()) {
        return false;
    }
    chars.all(|ch| ch == '_' || ch == '$' || ch.is_ascii_alphanumeric())
}

fn supported_language_for_path(path: &Path) -> Option<SupportLang> {
    let lang = SupportLang::from_path(path)?;
    match lang {
        SupportLang::Go
        | SupportLang::Html
        | SupportLang::JavaScript
        | SupportLang::Rust
        | SupportLang::TypeScript
        | SupportLang::Tsx => Some(lang),
        _ => None,
    }
}

fn is_searchable_file(path: &Path) -> bool {
    path.is_file()
        && fs::metadata(path)
            .map(|metadata| metadata.len() <= MAX_AST_SEARCH_FILE_BYTES)
            .unwrap_or(false)
}

fn line_starts(content: &str) -> Vec<usize> {
    let mut starts = vec![0];
    for (index, byte) in content.bytes().enumerate() {
        if byte == b'\n' {
            starts.push(index + 1);
        }
    }
    starts
}

fn line_index_for_offset(line_starts: &[usize], offset: usize) -> usize {
    line_starts
        .partition_point(|line_start| *line_start <= offset)
        .saturating_sub(1)
}

fn line_text_at(content: &str, line_starts: &[usize], line_index: usize) -> String {
    let start = line_starts[line_index];
    let end = line_starts
        .get(line_index + 1)
        .copied()
        .unwrap_or(content.len());
    content[start..end]
        .trim_end_matches(['\r', '\n'])
        .to_string()
}

fn context_before(content: &str, line_starts: &[usize], line_index: usize) -> Vec<String> {
    let start = line_index.saturating_sub(AST_REFERENCE_CONTEXT_LINES);
    (start..line_index)
        .map(|index| line_text_at(content, line_starts, index))
        .collect()
}

fn context_after(content: &str, line_starts: &[usize], line_index: usize) -> Vec<String> {
    let end = (line_index + 1 + AST_REFERENCE_CONTEXT_LINES).min(line_starts.len());
    ((line_index + 1)..end)
        .map(|index| line_text_at(content, line_starts, index))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::search_symbol_references_in_root;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn finds_go_function_and_method_call_sites() {
        let root = temp_project("ast-grep-go");
        write_file(
            &root,
            "main.go",
            r#"package main

func call() {
  run()
  worker.run()
  worker.runWithArgs(1, 2)
  other(run)
}
"#,
        );

        let results = search_symbol_references_in_root(&root, "run", 20, None).expect("search");

        let lines = results
            .iter()
            .map(|result| {
                (
                    result.path.as_str(),
                    result.line_number,
                    result.line_text.as_deref(),
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            lines,
            vec![
                ("main.go", Some(4), Some("  run()")),
                ("main.go", Some(5), Some("  worker.run()")),
            ]
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn finds_go_method_call_sites_with_arguments() {
        let root = temp_project("ast-grep-go-args");
        write_file(
            &root,
            "main.go",
            r#"package main

func call() {
  worker.run(1, 2)
}
"#,
        );

        let results = search_symbol_references_in_root(&root, "run", 20, None).expect("search");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].line_number, Some(4));
        assert_eq!(results[0].line_text.as_deref(), Some("  worker.run(1, 2)"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn finds_rust_associated_and_method_call_sites() {
        let root = temp_project("ast-grep-rust");
        write_file(
            &root,
            "src/lib.rs",
            r#"fn call() {
    run();
    worker.run();
    Worker::run();
}
"#,
        );

        let results = search_symbol_references_in_root(&root, "run", 20, None).expect("search");

        assert_eq!(results.len(), 3);
        assert_eq!(
            results
                .iter()
                .map(|result| result.line_number)
                .collect::<Vec<_>>(),
            vec![Some(2), Some(3), Some(4)]
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn finds_typescript_method_calls_without_matching_arguments() {
        let root = temp_project("ast-grep-typescript");
        write_file(
            &root,
            "src/main.ts",
            r#"function call() {
  run()
  worker.run(1, 2)
  other(run)
}
"#,
        );

        let results = search_symbol_references_in_root(&root, "run", 20, None).expect("search");
        let lines = results
            .iter()
            .map(|result| result.line_number)
            .collect::<Vec<_>>();

        assert_eq!(lines, vec![Some(2), Some(3)]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn narrows_search_languages_from_current_file() {
        let root = temp_project("ast-grep-current-lang");
        write_file(
            &root,
            "src/main.tsx",
            r#"function call() {
  run()
}
"#,
        );
        write_file(
            &root,
            "cmd/main.go",
            r#"package main

func call() {
  run()
}
"#,
        );

        let results = search_symbol_references_in_root(&root, "run", 20, Some("src/main.tsx"))
            .expect("search");
        let lines = results
            .iter()
            .map(|result| (result.path.as_str(), result.line_number))
            .collect::<Vec<_>>();

        assert_eq!(lines, vec![("src/main.tsx", Some(2))]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn respects_gitignore_when_searching_references() {
        let root = temp_project("ast-grep-gitignore");
        write_file(&root, ".gitignore", "ignored/\n");
        write_file(
            &root,
            "src/main.ts",
            r#"function call() {
  run()
}
"#,
        );
        write_file(
            &root,
            "ignored/hidden.ts",
            r#"function call() {
  run()
}
"#,
        );

        let results = search_symbol_references_in_root(&root, "run", 20, Some("src/main.ts"))
            .expect("search");
        let paths = results
            .iter()
            .map(|result| result.path.as_str())
            .collect::<Vec<_>>();

        assert_eq!(paths, vec!["src/main.ts"]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_non_identifier_queries() {
        let root = temp_project("ast-grep-invalid");
        let error = match search_symbol_references_in_root(&root, "run; rm", 20, None) {
            Ok(_) => panic!("query should be rejected"),
            Err(error) => error,
        };

        assert_eq!(error, "Symbol name must be an identifier");
        let _ = fs::remove_dir_all(root);
    }

    fn temp_project(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("view-{label}-{unique}"));
        fs::create_dir_all(&root).expect("create temp project");
        root
    }

    fn write_file(root: &std::path::Path, path: &str, content: &str) {
        let full_path = root.join(path);
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(full_path, content).expect("write file");
    }
}
