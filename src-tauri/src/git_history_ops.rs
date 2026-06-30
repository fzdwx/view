use serde::Deserialize;
use std::path::Path;

use crate::git_write::{git_write_response, GitWriteResponse};
use crate::{blocking_command, git, git_with_env, repository_root};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitHashRequest {
    pub(crate) path: String,
    pub(crate) commit: String,
}

const NONINTERACTIVE_HISTORY_ENV: &[(&str, &str)] = &[
    ("GIT_EDITOR", "true"),
    ("GIT_MERGE_AUTOEDIT", "no"),
];

#[tauri::command]
pub(crate) async fn cherry_pick_commit(
    request: CommitHashRequest,
) -> Result<GitWriteResponse, String> {
    blocking_command("cherry_pick_commit", move || {
        let root = repository_root(&request.path)?;
        let commit = resolve_history_commit(&root, &request.commit)?;
        git_with_env(
            &root,
            &["cherry-pick", "--no-edit", commit.as_str()],
            NONINTERACTIVE_HISTORY_ENV,
        )
        .map_err(|error| map_history_operation_error("cherry-pick", error))?;
        git_write_response(&root)
    })
    .await
}

#[tauri::command]
pub(crate) async fn revert_commit(request: CommitHashRequest) -> Result<GitWriteResponse, String> {
    blocking_command("revert_commit", move || {
        let root = repository_root(&request.path)?;
        let commit = resolve_history_commit(&root, &request.commit)?;
        git_with_env(
            &root,
            &["revert", "--no-edit", commit.as_str()],
            NONINTERACTIVE_HISTORY_ENV,
        )
        .map_err(|error| map_history_operation_error("revert", error))?;
        git_write_response(&root)
    })
    .await
}

fn resolve_history_commit(root: &Path, commit: &str) -> Result<String, String> {
    let trimmed = commit.trim();
    if trimmed.is_empty() {
        return Err("Commit is required".to_string());
    }
    if trimmed.contains('\0') {
        return Err("Commit cannot contain NUL bytes".to_string());
    }
    if trimmed.starts_with('-') || trimmed.chars().any(char::is_whitespace) {
        return Err("Commit must be a single revision".to_string());
    }

    let spec = format!("{trimmed}^{{commit}}");
    let output = git(root, &["rev-parse", "--verify", "--quiet", spec.as_str()])
        .map_err(|_| format!("Commit {trimmed} could not be resolved"))?;
    let hash = output.trim();
    if hash.is_empty() {
        return Err(format!("Commit {trimmed} could not be resolved"));
    }

    Ok(hash.to_string())
}

fn map_history_operation_error(operation: &str, error: String) -> String {
    let lower = error.to_ascii_lowercase();
    if lower.contains("conflict") || lower.contains("after resolving") {
        format!(
            "Git {operation} stopped with conflicts. Resolve them, then use Continue or Abort: {error}"
        )
    } else if lower.contains("local changes would be overwritten") {
        format!("Git {operation} requires a clean worktree: {error}")
    } else if lower.contains("empty") || lower.contains("nothing to commit") {
        format!("Git {operation} produced no changes: {error}")
    } else {
        format!("Git {operation} failed: {error}")
    }
}

#[cfg(test)]
#[path = "git_history_ops_tests.rs"]
mod tests;
