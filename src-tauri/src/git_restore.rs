use serde::Deserialize;
use std::fs;
use std::path::Path;

use crate::git_pathspec::git_args_with_pathspecs;
use crate::git_status::TreeFile;
use crate::git_write::{
    changed_file_for_pathspec, git_write_response, validate_write_pathspecs, GitWriteResponse,
};
use crate::{git_owned, repository_root, worktree_changed_files};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreFilesRequest {
    pub(crate) path: String,
    #[serde(default, alias = "filePaths")]
    pub(crate) paths: Vec<String>,
    pub(crate) mode: RestoreMode,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RestoreMode {
    Worktree,
    Staged,
    All,
}

#[tauri::command]
pub(crate) fn restore_files(request: RestoreFilesRequest) -> Result<GitWriteResponse, String> {
    let root = repository_root(&request.path)?;
    let pathspecs = validate_write_pathspecs(&root, &request.paths)?;
    let changed_files = worktree_changed_files(&root)?;
    validate_restorable_pathspecs(&changed_files, &pathspecs, request.mode)?;

    match request.mode {
        RestoreMode::Worktree => restore_worktree_pathspecs(&root, &changed_files, &pathspecs)?,
        RestoreMode::Staged => restore_staged_pathspecs(&root, &pathspecs)?,
        RestoreMode::All => restore_all_pathspecs(&root, &changed_files, &pathspecs)?,
    }

    git_write_response(&root)
}

fn validate_restorable_pathspecs(
    files: &[TreeFile],
    pathspecs: &[String],
    mode: RestoreMode,
) -> Result<(), String> {
    for pathspec in pathspecs {
        let file = changed_file_for_pathspec(files, pathspec)
            .ok_or_else(|| format!("No changes to restore for {pathspec}"))?;
        if file.conflict {
            return Err(format!("Cannot restore conflicted path: {pathspec}"));
        }

        match mode {
            RestoreMode::Worktree => validate_worktree_restore_pathspec(file, pathspec)?,
            RestoreMode::Staged => validate_staged_restore_pathspec(file, pathspec)?,
            RestoreMode::All => {}
        }
    }

    Ok(())
}

fn validate_worktree_restore_pathspec(file: &TreeFile, pathspec: &str) -> Result<(), String> {
    if file.untracked || file.unstaged {
        return Ok(());
    }
    if file.staged {
        return Err(format!(
            "Cannot restore staged-only path {pathspec}; unstage it first or use staged/all mode"
        ));
    }

    Err(format!("No worktree changes to restore for {pathspec}"))
}

fn validate_staged_restore_pathspec(file: &TreeFile, pathspec: &str) -> Result<(), String> {
    if !file.staged {
        return Err(format!("No staged changes to restore for {pathspec}"));
    }
    if file.unstaged {
        return Err(format!(
            "Cannot restore staged path {pathspec} while unstaged changes remain; use all mode"
        ));
    }

    Ok(())
}

fn restore_worktree_pathspecs(
    root: &Path,
    files: &[TreeFile],
    pathspecs: &[String],
) -> Result<(), String> {
    let (tracked_pathspecs, untracked_pathspecs) = split_restore_pathspecs(files, pathspecs);
    if !tracked_pathspecs.is_empty() {
        let args = git_args_with_pathspecs(&["restore", "--worktree"], &tracked_pathspecs);
        git_owned(root, &args)?;
    }
    remove_untracked_pathspecs(root, &untracked_pathspecs)
}

fn restore_staged_pathspecs(root: &Path, pathspecs: &[String]) -> Result<(), String> {
    let args = git_args_with_pathspecs(&["restore", "--staged", "--worktree"], pathspecs);
    git_owned(root, &args)?;
    Ok(())
}

fn restore_all_pathspecs(
    root: &Path,
    files: &[TreeFile],
    pathspecs: &[String],
) -> Result<(), String> {
    let (tracked_pathspecs, untracked_pathspecs) = split_restore_pathspecs(files, pathspecs);
    if !tracked_pathspecs.is_empty() {
        let args =
            git_args_with_pathspecs(&["restore", "--staged", "--worktree"], &tracked_pathspecs);
        git_owned(root, &args)?;
    }
    remove_untracked_pathspecs(root, &untracked_pathspecs)
}

fn split_restore_pathspecs(files: &[TreeFile], pathspecs: &[String]) -> (Vec<String>, Vec<String>) {
    let mut tracked_pathspecs = Vec::new();
    let mut untracked_pathspecs = Vec::new();

    for pathspec in pathspecs {
        match changed_file_for_pathspec(files, pathspec) {
            Some(file) if file.untracked => untracked_pathspecs.push(pathspec.clone()),
            Some(_) | None => tracked_pathspecs.push(pathspec.clone()),
        }
    }

    (tracked_pathspecs, untracked_pathspecs)
}

fn remove_untracked_pathspecs(root: &Path, pathspecs: &[String]) -> Result<(), String> {
    for pathspec in pathspecs {
        remove_untracked_pathspec(root, pathspec)?;
    }

    Ok(())
}

fn remove_untracked_pathspec(root: &Path, pathspec: &str) -> Result<(), String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve repository root: {error}"))?;
    let target = root.join(pathspec);
    let canonical_target = target
        .canonicalize()
        .map_err(|error| format!("Failed to resolve file path: {error}"))?;

    if !canonical_target.starts_with(&canonical_root) {
        return Err("File is outside the repository".to_string());
    }

    let metadata = fs::symlink_metadata(&target)
        .map_err(|error| format!("Failed to inspect untracked file {pathspec}: {error}"))?;
    if metadata.is_dir() {
        return Err(format!("Cannot discard untracked directory: {pathspec}"));
    }

    fs::remove_file(&target)
        .map_err(|error| format!("Failed to discard untracked file {pathspec}: {error}"))
}

#[cfg(test)]
#[path = "git_restore_tests.rs"]
mod tests;
