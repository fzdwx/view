use serde::Serialize;
use std::path::{Path, PathBuf};
use tree_sitter::{Node, Parser, TreeCursor};

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileRunTarget {
    pub(crate) id: String,
    pub(crate) language: String,
    pub(crate) kind: String,
    pub(crate) name: String,
    pub(crate) label: String,
    pub(crate) line: usize,
    pub(crate) command: String,
    pub(crate) cwd: Option<String>,
}

pub(crate) struct RunTargetRequest<'a> {
    pub(crate) root: &'a Path,
    pub(crate) file_path: &'a str,
    pub(crate) content: &'a str,
}

trait RunTargetProvider {
    fn targets(&self, request: &RunTargetRequest<'_>) -> Result<Vec<FileRunTarget>, String>;
}

pub(crate) fn file_run_targets(
    root: &Path,
    file_path: &str,
    content: &str,
) -> Result<Vec<FileRunTarget>, String> {
    let request = RunTargetRequest {
        root,
        file_path,
        content,
    };
    let providers: [&dyn RunTargetProvider; 1] = [&GoRunTargetProvider];
    let mut targets = Vec::new();

    for provider in providers {
        targets.extend(provider.targets(&request)?);
    }

    targets.sort_by(|left, right| {
        left.line
            .cmp(&right.line)
            .then_with(|| left.label.cmp(&right.label))
    });
    Ok(targets)
}

struct GoRunTargetProvider;

impl RunTargetProvider for GoRunTargetProvider {
    fn targets(&self, request: &RunTargetRequest<'_>) -> Result<Vec<FileRunTarget>, String> {
        if !request.file_path.ends_with(".go") {
            return Ok(Vec::new());
        }

        let mut parser = Parser::new();
        let language = tree_sitter_go::LANGUAGE.into();
        parser
            .set_language(&language)
            .map_err(|error| format!("Failed to initialize Go parser: {error}"))?;
        let tree = parser
            .parse(request.content, None)
            .ok_or_else(|| "Failed to parse Go file".to_string())?;
        let package_name = go_package_name(tree.root_node(), request.content);
        let (cwd, package_selector) = go_command_context(request.root, request.file_path)?;
        let mut targets = Vec::new();
        let mut cursor = tree.walk();

        visit_go_nodes(&mut cursor, &mut |node| {
            if node.kind() != "function_declaration" {
                return;
            }

            let Some(name_node) = node.child_by_field_name("name") else {
                return;
            };
            let Some(name) = node_text(name_node, request.content) else {
                return;
            };

            if package_name.as_deref() == Some("main") && name == "main" {
                targets.push(FileRunTarget {
                    id: format!(
                        "go:main:{}:{}",
                        request.file_path,
                        node.start_position().row + 1
                    ),
                    language: "go".to_string(),
                    kind: "main".to_string(),
                    name: name.to_string(),
                    label: "Run main".to_string(),
                    line: node.start_position().row + 1,
                    command: format!("go run {package_selector}"),
                    cwd: Some(cwd.clone()),
                });
                return;
            }

            if request.file_path.ends_with("_test.go")
                && runnable_go_test_name(name)
                && go_function_has_parameter(node, request.content, "*testing.T")
            {
                targets.push(FileRunTarget {
                    id: format!("go:test:{name}:{}", request.file_path),
                    language: "go".to_string(),
                    kind: "test".to_string(),
                    name: name.to_string(),
                    label: format!("Run {name}"),
                    line: node.start_position().row + 1,
                    command: format!("go test {package_selector} -run '^{name}$'"),
                    cwd: Some(cwd.clone()),
                });
            }
        });

        Ok(targets)
    }
}

fn visit_go_nodes(cursor: &mut TreeCursor<'_>, visit: &mut impl FnMut(Node<'_>)) {
    loop {
        let node = cursor.node();
        visit(node);

        if cursor.goto_first_child() {
            visit_go_nodes(cursor, visit);
            cursor.goto_parent();
        }

        if !cursor.goto_next_sibling() {
            break;
        }
    }
}

fn go_package_name(root: Node<'_>, content: &str) -> Option<String> {
    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        if child.kind() != "package_clause" {
            continue;
        }

        let mut package_cursor = child.walk();
        for package_child in child.children(&mut package_cursor) {
            if package_child.kind() == "package_identifier" {
                return node_text(package_child, content).map(str::to_string);
            }
        }
    }
    None
}

fn node_text<'a>(node: Node<'_>, content: &'a str) -> Option<&'a str> {
    content.get(node.byte_range())
}

fn runnable_go_test_name(name: &str) -> bool {
    let suffix = name.strip_prefix("Test");
    let Some(suffix) = suffix else {
        return false;
    };
    let Some(first) = suffix.chars().next() else {
        return false;
    };

    !first.is_ascii_lowercase()
}

fn go_function_has_parameter(node: Node<'_>, content: &str, parameter: &str) -> bool {
    node.child_by_field_name("parameters")
        .and_then(|parameters| node_text(parameters, content))
        .is_some_and(|text| text.contains(parameter))
}

fn go_command_context(root: &Path, file_path: &str) -> Result<(String, String), String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve project root: {error}"))?;
    let file_dir = root
        .join(file_path.replace('\\', "/"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| root.clone());
    let cwd = nearest_go_workspace_root(&root, &file_dir)?;
    let package_selector = go_package_selector(&cwd, &file_dir);
    Ok((cwd.to_string_lossy().to_string(), package_selector))
}

fn go_package_selector(cwd: &Path, file_dir: &Path) -> String {
    let relative = file_dir.strip_prefix(cwd).unwrap_or(file_dir);
    if relative.as_os_str().is_empty() {
        return ".".to_string();
    }

    format!("./{}", path_to_forward_slashes(relative))
}

fn path_to_forward_slashes(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn nearest_go_workspace_root(root: &Path, file_dir: &Path) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve project root: {error}"))?;
    let mut current = file_dir.to_path_buf();
    if !current.exists() {
        current = current
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| root.clone());
    }
    let mut current = current
        .canonicalize()
        .map_err(|error| format!("Failed to resolve Go file directory: {error}"))?;

    loop {
        if current.join("go.work").is_file() || current.join("go.mod").is_file() {
            return Ok(current);
        }
        if current == root {
            return Ok(root);
        }
        if !current.pop() {
            return Ok(root);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn detects_go_main_targets_with_workspace_cwd() {
        let repo = temp_repo("go-main-target");
        fs::create_dir_all(repo.join("cmd/view")).expect("create cmd");
        fs::write(repo.join("go.mod"), "module example.com/view\n").expect("write go.mod");

        let targets = file_run_targets(
            &repo,
            "cmd/view/main.go",
            "package main\n\nfunc main() {}\n",
        )
        .expect("targets");

        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].kind, "main");
        assert_eq!(targets[0].line, 3);
        assert_eq!(targets[0].command, "go run ./cmd/view");
        assert_eq!(targets[0].cwd, Some(repo.to_string_lossy().to_string()));
        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn detects_go_test_targets_and_ignores_test_helpers() {
        let repo = temp_repo("go-test-target");
        fs::create_dir_all(repo.join("internal/server")).expect("create package");
        fs::write(repo.join("go.mod"), "module example.com/view\n").expect("write go.mod");

        let targets = file_run_targets(
            &repo,
            "internal/server/http_test.go",
            "package server\n\nfunc Testhelper(t *testing.T) {}\nfunc TestMissingParam() {}\nfunc TestServeHTTP(t *testing.T) {}\n",
        )
        .expect("targets");

        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].kind, "test");
        assert_eq!(targets[0].name, "TestServeHTTP");
        assert_eq!(
            targets[0].command,
            "go test ./internal/server -run '^TestServeHTTP$'"
        );
        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn builds_package_selector_relative_to_nearest_go_module() {
        let repo = temp_repo("go-nested-module-target");
        fs::create_dir_all(repo.join("packages/server/internal/http")).expect("create package");
        fs::write(
            repo.join("packages/server/go.mod"),
            "module example.com/server\n",
        )
        .expect("write go.mod");

        let targets = file_run_targets(
            &repo,
            "packages/server/internal/http/main.go",
            "package main\n\nfunc main() {}\n",
        )
        .expect("targets");

        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].command, "go run ./internal/http");
        assert_eq!(
            targets[0].cwd,
            Some(repo.join("packages/server").to_string_lossy().to_string())
        );
        fs::remove_dir_all(repo).ok();
    }

    fn temp_repo(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let path = env::temp_dir().join(format!("view-{prefix}-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&path).expect("create temp repo");
        path
    }
}
