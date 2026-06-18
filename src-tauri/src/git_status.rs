use serde::Serialize;

pub(crate) const WORKTREE_STATUS_ARGS: &[&str] =
    &["status", "--porcelain=v1", "-z", "-uall", "--renames"];

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TreeFile {
    pub(crate) path: String,
    pub(crate) status: Option<String>,
    pub(crate) old_path: Option<String>,
    pub(crate) index_status: Option<String>,
    pub(crate) worktree_status: Option<String>,
    pub(crate) staged: bool,
    pub(crate) unstaged: bool,
    pub(crate) untracked: bool,
    pub(crate) renamed: bool,
    pub(crate) deleted: bool,
    pub(crate) conflict: bool,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StatusCounts {
    pub(crate) added: usize,
    pub(crate) modified: usize,
    pub(crate) deleted: usize,
    pub(crate) renamed: usize,
    pub(crate) untracked: usize,
}

pub(crate) fn parse_porcelain_v1_z_status(output: &str) -> Result<Vec<TreeFile>, String> {
    let mut files = Vec::new();
    let mut fields = output.split('\0').peekable();

    while let Some(entry) = fields.next() {
        if entry.is_empty() {
            if fields.peek().is_none() {
                break;
            }
            return Err("Malformed git status output: empty entry".to_string());
        }

        let file = parse_status_entry(entry, &mut fields)?;
        files.push(file);
    }

    sort_tree_files(&mut files);
    Ok(files)
}

pub(crate) fn parse_name_status_entries(output: &str) -> Vec<TreeFile> {
    let mut files = output
        .lines()
        .filter_map(parse_name_status_line)
        .collect::<Vec<_>>();
    sort_tree_files(&mut files);
    files
}

pub(crate) fn count_statuses(output: &str) -> Result<StatusCounts, String> {
    let files = parse_porcelain_v1_z_status(output)?;
    let mut counts = StatusCounts::default();

    for file in files {
        match file.status.as_deref() {
            Some("added") => counts.added += 1,
            Some("modified") => counts.modified += 1,
            Some("deleted") => counts.deleted += 1,
            Some("renamed") => counts.renamed += 1,
            Some("untracked") => counts.untracked += 1,
            Some("conflict") | None => {}
            Some(_) => {}
        }
    }

    Ok(counts)
}

pub(crate) fn normalize_git_path(path: &str) -> String {
    let trimmed = path.trim().trim_matches('"');
    trimmed
        .strip_prefix("b/")
        .or_else(|| trimmed.strip_prefix("a/"))
        .unwrap_or(trimmed)
        .to_string()
}

fn parse_status_entry<'a, I>(entry: &str, fields: &mut I) -> Result<TreeFile, String>
where
    I: Iterator<Item = &'a str>,
{
    if entry.len() < 4 {
        return Err(format!("Malformed git status output entry: {entry:?}"));
    }

    let bytes = entry.as_bytes();
    if bytes.get(2) != Some(&b' ') {
        return Err(format!("Malformed git status output entry: {entry:?}"));
    }

    let code = &entry[..2];
    let path = normalize_git_path(&entry[3..]);
    if path.is_empty() {
        return Err("Malformed git status output: empty path".to_string());
    }

    let old_path = if code.contains('R') || code.contains('C') {
        let raw_old_path = fields
            .next()
            .ok_or_else(|| format!("Malformed git status output: missing old path for {path}"))?;
        if raw_old_path.is_empty() {
            return Err(format!(
                "Malformed git status output: missing old path for {path}"
            ));
        }
        Some(normalize_git_path(raw_old_path))
    } else {
        None
    };

    Ok(tree_file_from_status_code(code, path, old_path))
}

fn parse_name_status_line(line: &str) -> Option<TreeFile> {
    let mut parts = line.split('\t');
    let code = parts.next()?;
    let first_path = parts.next()?;
    let second_path = parts.next();
    let status = name_status_code_to_status(code);
    let renamed = code.starts_with('R');
    let moved = renamed || code.starts_with('C');
    let old_path = moved.then(|| normalize_git_path(first_path));
    let path = if moved {
        second_path.unwrap_or(first_path)
    } else {
        first_path
    };

    Some(TreeFile {
        path: normalize_git_path(path),
        status: Some(status.to_string()),
        old_path,
        renamed,
        deleted: status == "deleted",
        conflict: status == "conflict",
        ..TreeFile::default()
    })
}

fn tree_file_from_status_code(code: &str, path: String, old_path: Option<String>) -> TreeFile {
    let index = status_char(code, 0);
    let worktree = status_char(code, 1);
    let status = status_code_to_status(code);
    let untracked = code == "??";
    let conflict = is_unmerged_status_code(code);

    TreeFile {
        path,
        status: Some(status.to_string()),
        old_path,
        index_status: visible_status(index),
        worktree_status: visible_status(worktree),
        staged: !untracked && index != ' ',
        unstaged: !untracked && worktree != ' ',
        untracked,
        renamed: code.contains('R'),
        deleted: code.contains('D'),
        conflict,
    }
}

fn status_char(code: &str, index: usize) -> char {
    code.chars().nth(index).unwrap_or(' ')
}

fn visible_status(status: char) -> Option<String> {
    (status != ' ').then(|| status.to_string())
}

fn name_status_code_to_status(code: &str) -> &'static str {
    if is_unmerged_status_code(code) {
        return "conflict";
    }

    match code.chars().next().unwrap_or('M') {
        'A' => "added",
        'D' => "deleted",
        'R' => "renamed",
        _ => "modified",
    }
}

fn status_code_to_status(code: &str) -> &'static str {
    match code {
        value if is_unmerged_status_code(value) => "conflict",
        "??" => "untracked",
        value if value.contains('R') => "renamed",
        value if value.contains('A') => "added",
        value if value.contains('D') => "deleted",
        _ => "modified",
    }
}

fn is_unmerged_status_code(code: &str) -> bool {
    code.contains('U') || matches!(code, "DD" | "AA")
}

fn sort_tree_files(files: &mut Vec<TreeFile>) {
    files.sort_by(|left, right| left.path.cmp(&right.path));
    files.dedup_by(|left, right| left.path == right.path);
}

#[cfg(test)]
mod tests {
    use super::parse_porcelain_v1_z_status;

    fn only_status_entry(output: &str) -> super::TreeFile {
        let files = parse_porcelain_v1_z_status(output).expect("parse status");
        assert_eq!(files.len(), 1);
        files.into_iter().next().expect("one status file")
    }

    #[test]
    fn status_parser_reports_modified_only_when_worktree_changed() {
        let file = only_status_entry(" M src/lib.rs\0");

        assert_eq!(file.path, "src/lib.rs");
        assert_eq!(file.status.as_deref(), Some("modified"));
        assert_eq!(file.index_status, None);
        assert_eq!(file.worktree_status.as_deref(), Some("M"));
        assert!(file.unstaged);
    }

    #[test]
    fn status_parser_reports_staged_only_when_index_changed() {
        let file = only_status_entry("M  README.md\0");

        assert_eq!(file.path, "README.md");
        assert_eq!(file.status.as_deref(), Some("modified"));
        assert_eq!(file.index_status.as_deref(), Some("M"));
        assert_eq!(file.worktree_status, None);
        assert!(file.staged);
    }

    #[test]
    fn changed_files_status_parser_reports_staged_and_unstaged_for_same_file() {
        let file = only_status_entry("MM src/app.ts\0");

        assert_eq!(file.path, "src/app.ts");
        assert_eq!(file.status.as_deref(), Some("modified"));
        assert_eq!(file.index_status.as_deref(), Some("M"));
        assert_eq!(file.worktree_status.as_deref(), Some("M"));
        assert!(file.staged);
        assert!(file.unstaged);
    }

    #[test]
    fn status_parser_reports_untracked_file() {
        let file = only_status_entry("?? notes/new.txt\0");

        assert_eq!(file.path, "notes/new.txt");
        assert_eq!(file.status.as_deref(), Some("untracked"));
        assert!(file.untracked);
    }

    #[test]
    fn status_parser_reports_deleted_file() {
        let file = only_status_entry(" D gone.txt\0");

        assert_eq!(file.path, "gone.txt");
        assert_eq!(file.status.as_deref(), Some("deleted"));
        assert!(file.deleted);
        assert!(file.unstaged);
    }

    #[test]
    fn changed_files_status_parser_reports_renamed_file_with_old_path() {
        let file = only_status_entry("R  src/new.rs\0src/old.rs\0");

        assert_eq!(file.path, "src/new.rs");
        assert_eq!(file.old_path.as_deref(), Some("src/old.rs"));
        assert_eq!(file.status.as_deref(), Some("renamed"));
        assert!(file.renamed);
        assert!(file.staged);
    }

    #[test]
    fn status_parser_reports_conflict_status() {
        let file = only_status_entry("UU src/conflict.rs\0");

        assert_eq!(file.path, "src/conflict.rs");
        assert_eq!(file.status.as_deref(), Some("conflict"));
        assert!(file.conflict);
        assert!(file.staged);
        assert!(file.unstaged);
    }

    #[test]
    fn status_parser_rejects_malformed_rename_without_old_path() {
        let error = parse_porcelain_v1_z_status("R  src/new.rs\0").expect_err("missing old path");

        assert!(error.contains("missing old path"));
    }
}
