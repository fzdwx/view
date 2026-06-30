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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AmendCommitRequest {
    pub(crate) path: String,
    pub(crate) message: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RewordCommitRequest {
    pub(crate) path: String,
    pub(crate) commit: String,
    pub(crate) message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartInteractiveRebaseRequest {
    pub(crate) path: String,
    pub(crate) base: String,
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

#[tauri::command]
pub(crate) async fn amend_commit(request: AmendCommitRequest) -> Result<GitWriteResponse, String> {
    blocking_command("amend_commit", move || {
        let root = repository_root(&request.path)?;
        let mut args = vec!["commit", "--amend"];
        let message = request.message.as_deref().map(str::trim).unwrap_or_default();
        if message.is_empty() {
            args.push("--no-edit");
        } else {
            if message.contains('\0') {
                return Err("Commit message cannot contain NUL bytes".to_string());
            }
            args.push("-m");
            args.push(message);
        }
        git_with_env(&root, &args, NONINTERACTIVE_HISTORY_ENV)
            .map_err(|error| map_history_operation_error("amend", error))?;
        git_write_response(&root)
    })
    .await
}

#[tauri::command]
pub(crate) async fn fixup_commit(request: CommitHashRequest) -> Result<GitWriteResponse, String> {
    blocking_command("fixup_commit", move || {
        let root = repository_root(&request.path)?;
        let commit = resolve_history_commit(&root, &request.commit)?;
        git_with_env(
            &root,
            &["commit", "--fixup", commit.as_str()],
            NONINTERACTIVE_HISTORY_ENV,
        )
        .map_err(|error| map_history_operation_error("fixup", error))?;
        git_write_response(&root)
    })
    .await
}

#[tauri::command]
pub(crate) async fn reword_commit(
    request: RewordCommitRequest,
) -> Result<GitWriteResponse, String> {
    blocking_command("reword_commit", move || {
        let root = repository_root(&request.path)?;
        let commit = resolve_history_commit(&root, &request.commit)?;
        ensure_commit_is_head(&root, &commit, "reword")?;
        let message = request.message.trim();
        if message.is_empty() {
            return Err("Commit message cannot be empty".to_string());
        }
        if message.contains('\0') {
            return Err("Commit message cannot contain NUL bytes".to_string());
        }
        git_with_env(
            &root,
            &["commit", "--amend", "-m", message],
            NONINTERACTIVE_HISTORY_ENV,
        )
        .map_err(|error| map_history_operation_error("reword", error))?;
        git_write_response(&root)
    })
    .await
}

#[tauri::command]
pub(crate) async fn squash_commit(request: CommitHashRequest) -> Result<GitWriteResponse, String> {
    blocking_command("squash_commit", move || {
        let root = repository_root(&request.path)?;
        let commit = resolve_history_commit(&root, &request.commit)?;
        ensure_commit_is_head(&root, &commit, "squash")?;
        git(&root, &["rev-parse", "--verify", "HEAD^"])
            .map_err(|_| "Cannot squash the root commit into a parent".to_string())?;
        git_with_env(&root, &["reset", "--soft", "HEAD^"], NONINTERACTIVE_HISTORY_ENV)
            .map_err(|error| map_history_operation_error("squash", error))?;
        git_with_env(
            &root,
            &["commit", "--amend", "--no-edit"],
            NONINTERACTIVE_HISTORY_ENV,
        )
        .map_err(|error| map_history_operation_error("squash", error))?;
        git_write_response(&root)
    })
    .await
}

#[tauri::command]
pub(crate) async fn start_interactive_rebase(
    request: StartInteractiveRebaseRequest,
) -> Result<GitWriteResponse, String> {
    blocking_command("start_interactive_rebase", move || {
        let root = repository_root(&request.path)?;
        let base = resolve_rebase_base(&root, &request.base)?;
        git_with_env(
            &root,
            &["rebase", "-i", "--autosquash", base.as_str()],
            &[("GIT_SEQUENCE_EDITOR", "true"), ("GIT_EDITOR", "true")],
        )
        .map_err(|error| map_history_operation_error("rebase", error))?;
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

fn resolve_rebase_base(root: &Path, base: &str) -> Result<String, String> {
    let trimmed = base.trim();
    if trimmed.is_empty() {
        return Err("Rebase base is required".to_string());
    }
    if trimmed.contains('\0') || trimmed.starts_with('-') || trimmed.chars().any(char::is_whitespace)
    {
        return Err("Rebase base must be a single revision".to_string());
    }
    let output = git(root, &["rev-parse", "--verify", "--quiet", trimmed])
        .map_err(|_| format!("Rebase base {trimmed} could not be resolved"))?;
    let hash = output.trim();
    if hash.is_empty() {
        return Err(format!("Rebase base {trimmed} could not be resolved"));
    }
    Ok(hash.to_string())
}

fn ensure_commit_is_head(root: &Path, commit: &str, operation: &str) -> Result<(), String> {
    let head = git(root, &["rev-parse", "HEAD"])?.trim().to_string();
    if head == commit {
        Ok(())
    } else {
        Err(format!("Can only {operation} HEAD in this lightweight history editor"))
    }
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
