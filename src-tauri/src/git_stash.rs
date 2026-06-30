use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::git_write::{git_write_response, GitWriteResponse};
use crate::{blocking_command, git, git_owned, repository_root};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StashRequest {
    pub(crate) path: String,
    pub(crate) selector: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateStashRequest {
    pub(crate) path: String,
    pub(crate) message: String,
    #[serde(default)]
    pub(crate) include_untracked: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StashEntry {
    pub(crate) selector: String,
    pub(crate) hash: String,
    pub(crate) branch: String,
    pub(crate) message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StashListResponse {
    pub(crate) entries: Vec<StashEntry>,
}

#[tauri::command]
pub(crate) async fn list_stashes(path: String) -> Result<StashListResponse, String> {
    blocking_command("list_stashes", move || {
        let root = repository_root(&path)?;
        Ok(StashListResponse {
            entries: parse_stash_list(&git(
                &root,
                &["stash", "list", "--format=%gd%x1f%H%x1f%gs"],
            )?),
        })
    })
    .await
}

#[tauri::command]
pub(crate) async fn create_stash(request: CreateStashRequest) -> Result<GitWriteResponse, String> {
    blocking_command("create_stash", move || {
        let root = repository_root(&request.path)?;
        let message = normalize_stash_message(&request.message)?;
        let mut args = vec!["stash".to_string(), "push".to_string()];
        if request.include_untracked {
            args.push("--include-untracked".to_string());
        }
        args.push("-m".to_string());
        args.push(message);
        git_owned(&root, &args).map_err(map_stash_error)?;
        git_write_response(&root)
    })
    .await
}

#[tauri::command]
pub(crate) async fn apply_stash(request: StashRequest) -> Result<GitWriteResponse, String> {
    blocking_command("apply_stash", move || {
        let root = repository_root(&request.path)?;
        let selector = normalize_stash_selector(&request.selector)?;
        git(&root, &["stash", "apply", selector.as_str()]).map_err(map_stash_error)?;
        git_write_response(&root)
    })
    .await
}

#[tauri::command]
pub(crate) async fn pop_stash(request: StashRequest) -> Result<GitWriteResponse, String> {
    blocking_command("pop_stash", move || {
        let root = repository_root(&request.path)?;
        let selector = normalize_stash_selector(&request.selector)?;
        git(&root, &["stash", "pop", selector.as_str()]).map_err(map_stash_error)?;
        git_write_response(&root)
    })
    .await
}

#[tauri::command]
pub(crate) async fn drop_stash(request: StashRequest) -> Result<GitWriteResponse, String> {
    blocking_command("drop_stash", move || {
        let root = repository_root(&request.path)?;
        let selector = normalize_stash_selector(&request.selector)?;
        git(&root, &["stash", "drop", selector.as_str()]).map_err(map_stash_error)?;
        git_write_response(&root)
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_stash_diff(path: String, selector: String) -> Result<String, String> {
    blocking_command("get_stash_diff", move || {
        let root = repository_root(&path)?;
        stash_diff(&root, &selector)
    })
    .await
}

fn stash_diff(root: &Path, selector: &str) -> Result<String, String> {
    let selector = normalize_stash_selector(selector)?;
    git(
        root,
        &[
            "stash",
            "show",
            "--patch",
            "--include-untracked",
            "--no-ext-diff",
            selector.as_str(),
        ],
    )
    .map_err(map_stash_error)
}

fn parse_stash_list(output: &str) -> Vec<StashEntry> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\x1f');
            let selector = parts.next()?.trim();
            let hash = parts.next()?.trim();
            let subject = parts.next()?.trim();
            if selector.is_empty() || hash.is_empty() {
                return None;
            }

            let (branch, message) = parse_stash_subject(subject);
            Some(StashEntry {
                selector: selector.to_string(),
                hash: hash.to_string(),
                branch,
                message,
            })
        })
        .collect()
}

fn parse_stash_subject(subject: &str) -> (String, String) {
    let subject = subject.trim();
    if let Some(rest) = subject.strip_prefix("On ") {
        if let Some((branch, message)) = rest.split_once(": ") {
            return (branch.to_string(), message.to_string());
        }
    }
    if let Some(rest) = subject.strip_prefix("WIP on ") {
        if let Some((branch_and_head, message)) = rest.split_once(": ") {
            let branch = branch_and_head
                .split_whitespace()
                .next()
                .unwrap_or("unknown")
                .to_string();
            return (branch, message.to_string());
        }
    }

    ("unknown".to_string(), subject.to_string())
}

fn normalize_stash_message(message: &str) -> Result<String, String> {
    let trimmed = message.trim();
    if trimmed.contains('\0') {
        return Err("Stash message cannot contain NUL bytes".to_string());
    }
    if trimmed.is_empty() {
        Ok("WIP".to_string())
    } else {
        Ok(trimmed.to_string())
    }
}

fn normalize_stash_selector(selector: &str) -> Result<String, String> {
    let trimmed = selector.trim();
    let Some(index) = trimmed
        .strip_prefix("stash@{")
        .and_then(|value| value.strip_suffix('}'))
    else {
        return Err("Only numeric stash selectors are supported".to_string());
    };

    if index.is_empty() || !index.chars().all(|character| character.is_ascii_digit()) {
        return Err("Only numeric stash selectors are supported".to_string());
    }

    Ok(trimmed.to_string())
}

fn map_stash_error(error: String) -> String {
    let lower = error.to_ascii_lowercase();
    if lower.contains("no local changes to save") {
        return "No local changes to stash".to_string();
    }
    if lower.contains("unknown switch") || lower.contains("not a valid reference") {
        return "Stash entry was not found".to_string();
    }

    error
}

#[cfg(test)]
#[path = "git_stash_tests.rs"]
mod tests;
