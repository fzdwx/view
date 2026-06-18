use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

use crate::git_pathspec::{git_args_with_pathspecs, validate_existing_pathspecs};
use crate::git_status::TreeFile;
use crate::{
    git_owned, git_show_bytes, repository_root, repository_summary, worktree_changed_files,
    RepositorySummary,
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

#[tauri::command]
pub(crate) fn stage_files(request: GitPathsRequest) -> Result<GitWriteResponse, String> {
    let root = repository_root(&request.path)?;
    let pathspecs = validate_write_pathspecs(&root, &request.paths)?;
    let changed_files = worktree_changed_files(&root)?;
    validate_stageable_pathspecs(&changed_files, &pathspecs)?;

    let stage_pathspecs = stage_pathspecs_with_rename_pairs(&root, &changed_files, &pathspecs)?;
    let args = git_args_with_pathspecs(&["add"], &stage_pathspecs);
    git_owned(&root, &args)?;
    git_write_response(&root)
}

#[tauri::command]
pub(crate) fn unstage_files(request: GitPathsRequest) -> Result<GitWriteResponse, String> {
    let root = repository_root(&request.path)?;
    let pathspecs = validate_write_pathspecs(&root, &request.paths)?;
    let changed_files = worktree_changed_files(&root)?;
    validate_unstageable_pathspecs(&changed_files, &pathspecs)?;

    let args = git_args_with_pathspecs(&["restore", "--staged"], &pathspecs);
    git_owned(&root, &args)?;
    git_write_response(&root)
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
