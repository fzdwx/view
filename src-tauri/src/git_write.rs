use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};

use crate::git_pathspec::{git_args_with_pathspecs, validate_existing_pathspecs};
use crate::git_status::TreeFile;
use crate::{
    blocking_command, git_owned, git_show_bytes, repository_root, repository_summary,
    worktree_changed_files, RepositorySummary,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitPathsRequest {
    pub(crate) path: String,
    #[serde(default, alias = "filePaths")]
    pub(crate) paths: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitWriteResponse {
    pub(crate) summary: RepositorySummary,
    pub(crate) files: Vec<TreeFile>,
}

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum GitChangeSource {
    Worktree,
    Staged,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum GitChangeOperation {
    Stage,
    Unstage,
    Discard,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitFileChangeRequest {
    pub(crate) path: String,
    pub(crate) file_path: String,
    pub(crate) source: GitChangeSource,
    pub(crate) operation: GitChangeOperation,
    pub(crate) old_start: usize,
    pub(crate) old_line_count: usize,
    pub(crate) new_start: usize,
    pub(crate) new_line_count: usize,
}

#[tauri::command]
pub(crate) async fn stage_files(request: GitPathsRequest) -> Result<GitWriteResponse, String> {
    blocking_command("stage_files", move || {
        let root = repository_root(&request.path)?;
        let pathspecs = validate_write_pathspecs(&root, &request.paths)?;
        let changed_files = worktree_changed_files(&root)?;
        validate_stageable_pathspecs(&changed_files, &pathspecs)?;

        let stage_pathspecs = stage_pathspecs_with_rename_pairs(&root, &changed_files, &pathspecs)?;
        let args = git_args_with_pathspecs(&["add"], &stage_pathspecs);
        git_owned(&root, &args)?;
        git_write_response(&root)
    })
    .await
}

#[tauri::command]
pub(crate) async fn unstage_files(request: GitPathsRequest) -> Result<GitWriteResponse, String> {
    blocking_command("unstage_files", move || {
        let root = repository_root(&request.path)?;
        let pathspecs = validate_write_pathspecs(&root, &request.paths)?;
        let changed_files = worktree_changed_files(&root)?;
        validate_unstageable_pathspecs(&changed_files, &pathspecs)?;

        let args = git_args_with_pathspecs(&["restore", "--staged"], &pathspecs);
        git_owned(&root, &args)?;
        git_write_response(&root)
    })
    .await
}

#[tauri::command]
pub(crate) async fn mark_conflicts_resolved(
    request: GitPathsRequest,
) -> Result<GitWriteResponse, String> {
    blocking_command("mark_conflicts_resolved", move || {
        let root = repository_root(&request.path)?;
        let pathspecs = validate_write_pathspecs(&root, &request.paths)?;
        let changed_files = worktree_changed_files(&root)?;
        validate_conflict_pathspecs(&changed_files, &pathspecs)?;

        let args = git_args_with_pathspecs(&["add"], &pathspecs);
        git_owned(&root, &args)?;
        git_write_response(&root)
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_file_status_diff(
    path: String,
    file_path: String,
    source: GitChangeSource,
) -> Result<String, String> {
    blocking_command("get_file_status_diff", move || {
        let root = repository_root(&path)?;
        let pathspecs = validate_write_pathspecs(&root, &[file_path])?;
        let file_path = pathspecs
            .first()
            .ok_or_else(|| "File path is required".to_string())?;
        file_diff_for_source(&root, file_path, source, 8)
    })
    .await
}

#[tauri::command]
pub(crate) async fn apply_file_change(
    request: GitFileChangeRequest,
) -> Result<GitWriteResponse, String> {
    blocking_command("apply_file_change", move || {
        validate_change_operation(request.source, request.operation)?;

        let root = repository_root(&request.path)?;
        let pathspecs = validate_write_pathspecs(&root, &[request.file_path])?;
        let file_path = pathspecs
            .first()
            .ok_or_else(|| "File path is required".to_string())?;
        let changed_files = worktree_changed_files(&root)?;
        validate_patchable_pathspec(&changed_files, file_path, request.source, request.operation)?;

        let diff = file_diff_for_source(&root, file_path, request.source, 0)?;
        let patch = patch_for_change(
            &diff,
            request.old_start,
            request.old_line_count,
            request.new_start,
            request.new_line_count,
        )?;
        apply_patch_for_operation(&root, request.operation, &patch)?;
        git_write_response(&root)
    })
    .await
}

pub(crate) fn validate_write_pathspecs(
    root: &Path,
    paths: &[String],
) -> Result<Vec<String>, String> {
    if paths.is_empty() {
        return Err("At least one file path is required".to_string());
    }

    validate_existing_pathspecs(root, paths)
}

fn stage_pathspecs_with_rename_pairs(
    root: &Path,
    files: &[TreeFile],
    pathspecs: &[String],
) -> Result<Vec<String>, String> {
    let mut expanded = Vec::with_capacity(pathspecs.len().saturating_mul(2));

    for pathspec in pathspecs {
        push_unique_pathspec(&mut expanded, pathspec);
        let Some(file) = changed_file_for_pathspec(files, pathspec) else {
            continue;
        };

        if let Some(old_path) = &file.old_path {
            push_unique_pathspec(&mut expanded, &file.path);
            push_unique_pathspec(&mut expanded, old_path);
            continue;
        }

        if file.untracked {
            if let Some(old_path) = matching_deleted_rename_source(root, files, &file.path)? {
                push_unique_pathspec(&mut expanded, &old_path);
            }
            continue;
        }

        if file.deleted && file.unstaged {
            if let Some(new_path) = matching_untracked_rename_target(root, files, &file.path)? {
                push_unique_pathspec(&mut expanded, &new_path);
            }
        }
    }

    Ok(expanded)
}

fn matching_deleted_rename_source(
    root: &Path,
    files: &[TreeFile],
    untracked_path: &str,
) -> Result<Option<String>, String> {
    let untracked_bytes = read_worktree_rename_candidate(root, untracked_path)?;
    let mut matched_path = None;

    for file in files
        .iter()
        .filter(|file| file.deleted && file.unstaged && !file.staged && !file.conflict)
    {
        let deleted_bytes = git_show_bytes(root, "HEAD", &file.path)?;
        if deleted_bytes == untracked_bytes {
            if matched_path.is_some() {
                return Ok(None);
            }
            matched_path = Some(file.path.clone());
        }
    }

    Ok(matched_path)
}

fn matching_untracked_rename_target(
    root: &Path,
    files: &[TreeFile],
    deleted_path: &str,
) -> Result<Option<String>, String> {
    let deleted_bytes = git_show_bytes(root, "HEAD", deleted_path)?;
    let mut matched_path = None;

    for file in files.iter().filter(|file| file.untracked && !file.conflict) {
        let untracked_bytes = read_worktree_rename_candidate(root, &file.path)?;
        if untracked_bytes == deleted_bytes {
            if matched_path.is_some() {
                return Ok(None);
            }
            matched_path = Some(file.path.clone());
        }
    }

    Ok(matched_path)
}

fn read_worktree_rename_candidate(root: &Path, path: &str) -> Result<Vec<u8>, String> {
    fs::read(root.join(path))
        .map_err(|error| format!("Failed to read rename candidate {path}: {error}"))
}

fn push_unique_pathspec(pathspecs: &mut Vec<String>, pathspec: &str) {
    if !pathspecs.iter().any(|candidate| candidate == pathspec) {
        pathspecs.push(pathspec.to_string());
    }
}

fn validate_stageable_pathspecs(files: &[TreeFile], pathspecs: &[String]) -> Result<(), String> {
    for pathspec in pathspecs {
        let file = changed_file_for_pathspec(files, pathspec)
            .ok_or_else(|| format!("No worktree changes to stage for {pathspec}"))?;
        if file.conflict {
            return Err(format!("Cannot stage conflicted path: {pathspec}"));
        }
        if !file.untracked && !file.unstaged {
            return Err(format!("No worktree changes to stage for {pathspec}"));
        }
    }

    Ok(())
}

fn validate_unstageable_pathspecs(files: &[TreeFile], pathspecs: &[String]) -> Result<(), String> {
    for pathspec in pathspecs {
        let file = changed_file_for_pathspec(files, pathspec)
            .ok_or_else(|| format!("No staged changes to unstage for {pathspec}"))?;
        if file.conflict {
            return Err(format!("Cannot unstage conflicted path: {pathspec}"));
        }
        if !file.staged {
            return Err(format!("No staged changes to unstage for {pathspec}"));
        }
    }

    Ok(())
}

fn validate_conflict_pathspecs(files: &[TreeFile], pathspecs: &[String]) -> Result<(), String> {
    for pathspec in pathspecs {
        let file = changed_file_for_pathspec(files, pathspec)
            .ok_or_else(|| format!("No conflicted file found for {pathspec}"))?;
        if !file.conflict {
            return Err(format!("File is not conflicted: {pathspec}"));
        }
    }

    Ok(())
}

fn validate_patchable_pathspec(
    files: &[TreeFile],
    pathspec: &str,
    source: GitChangeSource,
    operation: GitChangeOperation,
) -> Result<(), String> {
    let file = changed_file_for_pathspec(files, pathspec)
        .ok_or_else(|| format!("No changes found for {pathspec}"))?;
    if file.conflict {
        return Err(format!(
            "Cannot apply partial changes to conflicted path: {pathspec}"
        ));
    }

    match (source, operation) {
        (GitChangeSource::Worktree, GitChangeOperation::Stage)
            if file.unstaged || file.untracked =>
        {
            Ok(())
        }
        (GitChangeSource::Worktree, GitChangeOperation::Discard)
            if file.unstaged || file.untracked =>
        {
            Ok(())
        }
        (GitChangeSource::Staged, GitChangeOperation::Unstage) if file.staged => Ok(()),
        (GitChangeSource::Worktree, GitChangeOperation::Stage) => {
            Err(format!("No worktree changes to stage for {pathspec}"))
        }
        (GitChangeSource::Worktree, GitChangeOperation::Discard) => {
            Err(format!("No worktree changes to discard for {pathspec}"))
        }
        (GitChangeSource::Staged, GitChangeOperation::Unstage) => {
            Err(format!("No staged changes to unstage for {pathspec}"))
        }
        _ => Err("Invalid partial Git operation".to_string()),
    }
}

fn validate_change_operation(
    source: GitChangeSource,
    operation: GitChangeOperation,
) -> Result<(), String> {
    match (source, operation) {
        (GitChangeSource::Worktree, GitChangeOperation::Stage)
        | (GitChangeSource::Worktree, GitChangeOperation::Discard)
        | (GitChangeSource::Staged, GitChangeOperation::Unstage) => Ok(()),
        _ => Err("Invalid partial Git operation for this change source".to_string()),
    }
}

fn file_diff_for_source(
    root: &Path,
    file_path: &str,
    source: GitChangeSource,
    unified: usize,
) -> Result<String, String> {
    let unified_arg = format!("--unified={unified}");
    match source {
        GitChangeSource::Worktree => {
            if is_untracked_file(root, file_path) {
                return git_untracked_file_diff_with_unified(root, file_path, &unified_arg);
            }
            git_owned(
                root,
                &git_args_with_pathspecs(
                    &["diff", "--no-ext-diff", &unified_arg],
                    &[file_path.to_string()],
                ),
            )
        }
        GitChangeSource::Staged => git_owned(
            root,
            &git_args_with_pathspecs(
                &["diff", "--cached", "--no-ext-diff", &unified_arg],
                &[file_path.to_string()],
            ),
        ),
    }
}

fn is_untracked_file(root: &Path, file_path: &str) -> bool {
    let pathspecs = vec![file_path.to_string()];
    let args = git_args_with_pathspecs(&["ls-files", "--others", "--exclude-standard"], &pathspecs);
    let output = git_owned(root, &args).unwrap_or_default();
    output.lines().any(|path| path == file_path)
}

fn git_untracked_file_diff_with_unified(
    root: &Path,
    file_path: &str,
    unified_arg: &str,
) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-c")
        .arg("core.quotepath=false")
        .arg("-C")
        .arg(root)
        .args([
            "diff",
            "--no-index",
            "--no-ext-diff",
            unified_arg,
            "--",
            "/dev/null",
            file_path,
        ])
        .output()
        .map_err(|error| format!("Failed to run git: {error}"))?;

    if matches!(output.status.code(), Some(0 | 1)) {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if message.is_empty() {
            "git command failed".to_string()
        } else {
            message
        })
    }
}

fn patch_for_change(
    diff: &str,
    old_start: usize,
    old_line_count: usize,
    new_start: usize,
    new_line_count: usize,
) -> Result<String, String> {
    let mut file_header: Vec<String> = Vec::new();
    let mut current_hunk: Vec<String> = Vec::new();
    let mut current_hunk_matches = false;
    let mut in_hunk = false;

    for line in diff.lines() {
        if line.starts_with("diff --git ") {
            if current_hunk_matches {
                return Ok(join_patch(&file_header, &current_hunk));
            }
            file_header.clear();
            current_hunk.clear();
            current_hunk_matches = false;
            in_hunk = false;
            file_header.push(line.to_string());
            continue;
        }

        if line.starts_with("@@ ") {
            if current_hunk_matches {
                return Ok(join_patch(&file_header, &current_hunk));
            }
            let range = parse_hunk_range(line)?;
            current_hunk.clear();
            current_hunk.push(line.to_string());
            current_hunk_matches = range.old_start == old_start
                && range.old_count == old_line_count
                && range.new_start == new_start
                && range.new_count == new_line_count;
            in_hunk = true;
            continue;
        }

        if in_hunk {
            current_hunk.push(line.to_string());
        } else if !file_header.is_empty() {
            file_header.push(line.to_string());
        }
    }

    if current_hunk_matches {
        return Ok(join_patch(&file_header, &current_hunk));
    }

    Err("Selected change no longer matches the current Git diff".to_string())
}

struct HunkRange {
    old_start: usize,
    old_count: usize,
    new_start: usize,
    new_count: usize,
}

fn parse_hunk_range(header: &str) -> Result<HunkRange, String> {
    let mut parts = header.split_whitespace();
    if parts.next() != Some("@@") {
        return Err(format!("Invalid hunk header: {header}"));
    }
    let old = parts
        .next()
        .ok_or_else(|| format!("Invalid hunk header: {header}"))?;
    let new = parts
        .next()
        .ok_or_else(|| format!("Invalid hunk header: {header}"))?;
    let (old_start, old_count) = parse_hunk_side(old, '-')?;
    let (new_start, new_count) = parse_hunk_side(new, '+')?;

    Ok(HunkRange {
        old_start,
        old_count,
        new_start,
        new_count,
    })
}

fn parse_hunk_side(side: &str, prefix: char) -> Result<(usize, usize), String> {
    let value = side
        .strip_prefix(prefix)
        .ok_or_else(|| format!("Invalid hunk range: {side}"))?;
    match value.split_once(',') {
        Some((start, count)) => Ok((
            start
                .parse::<usize>()
                .map_err(|_| format!("Invalid hunk start: {side}"))?,
            count
                .parse::<usize>()
                .map_err(|_| format!("Invalid hunk count: {side}"))?,
        )),
        None => Ok((
            value
                .parse::<usize>()
                .map_err(|_| format!("Invalid hunk start: {side}"))?,
            1,
        )),
    }
}

fn join_patch(file_header: &[String], hunk: &[String]) -> String {
    let mut lines = Vec::with_capacity(file_header.len() + hunk.len());
    lines.extend(file_header.iter().cloned());
    lines.extend(hunk.iter().cloned());
    format!("{}\n", lines.join("\n"))
}

fn apply_patch_for_operation(
    root: &Path,
    operation: GitChangeOperation,
    patch: &str,
) -> Result<(), String> {
    let args = match operation {
        GitChangeOperation::Stage => vec!["apply", "--cached", "--unidiff-zero"],
        GitChangeOperation::Unstage => {
            vec!["apply", "--cached", "--reverse", "--unidiff-zero"]
        }
        GitChangeOperation::Discard => vec!["apply", "--reverse", "--unidiff-zero"],
    };
    git_with_stdin(root, &args, patch)?;
    Ok(())
}

fn git_with_stdin(root: &Path, args: &[&str], stdin: &str) -> Result<String, String> {
    let mut child = Command::new("git")
        .arg("-c")
        .arg("core.quotepath=false")
        .arg("-C")
        .arg(root)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to run git: {error}"))?;

    {
        use std::io::Write;
        let pipe = child
            .stdin
            .as_mut()
            .ok_or_else(|| "Failed to open git stdin".to_string())?;
        pipe.write_all(stdin.as_bytes())
            .map_err(|error| format!("Failed to write git patch: {error}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("Failed to wait for git: {error}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if message.is_empty() {
            "git command failed".to_string()
        } else {
            message
        })
    }
}

pub(crate) fn changed_file_for_pathspec<'a>(
    files: &'a [TreeFile],
    pathspec: &str,
) -> Option<&'a TreeFile> {
    files
        .iter()
        .find(|file| file.path == pathspec || file.old_path.as_deref() == Some(pathspec))
}

pub(crate) fn git_write_response(root: &Path) -> Result<GitWriteResponse, String> {
    Ok(GitWriteResponse {
        summary: repository_summary(root)?,
        files: worktree_changed_files(root)?,
    })
}

#[cfg(test)]
#[path = "git_write_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "git_write_pathspec_tests.rs"]
mod pathspec_tests;
