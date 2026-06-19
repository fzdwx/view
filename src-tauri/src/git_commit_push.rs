use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::git_status::TreeFile;
use crate::git_write::{git_write_response, GitWriteResponse};
use crate::{git, git_with_env, git_with_env_stdout_on_error, repository_root, RepositorySummary};

const NONINTERACTIVE_GIT_ENV: &[(&str, &str)] = &[
    ("GIT_TERMINAL_PROMPT", "0"),
    ("GCM_INTERACTIVE", "never"),
    ("GCM_TERMINAL_PROMPT", "0"),
    ("SSH_ASKPASS_REQUIRE", "never"),
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitRequest {
    pub(crate) path: String,
    pub(crate) message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResetHardToReflogRequest {
    pub(crate) path: String,
    pub(crate) selector: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitWriteResponse {
    pub(crate) hash: String,
    pub(crate) short_hash: String,
    pub(crate) summary: RepositorySummary,
    pub(crate) files: Vec<TreeFile>,
}

#[tauri::command]
pub(crate) fn create_commit(request: CommitRequest) -> Result<CommitWriteResponse, String> {
    let root = repository_root(&request.path)?;
    let message = request.message.trim();
    if message.is_empty() {
        return Err("Commit message cannot be empty".to_string());
    }
    if message.contains('\0') {
        return Err("Commit message cannot contain NUL bytes".to_string());
    }

    ensure_staged_changes(&root)?;
    git(&root, &["commit", "-m", message]).map_err(map_commit_error)?;

    let hash = git_trim(&root, &["rev-parse", "HEAD"])?;
    let short_hash = git_trim(&root, &["rev-parse", "--short", "HEAD"])?;
    let response = git_write_response(&root)?;
    Ok(CommitWriteResponse {
        hash,
        short_hash,
        summary: response.summary,
        files: response.files,
    })
}

#[tauri::command]
pub(crate) fn push_current_branch(path: String) -> Result<GitWriteResponse, String> {
    let root = repository_root(&path)?;
    let target = resolve_push_target(&root)?;
    validate_push_state(&root, &target)?;

    let refspec = format!("HEAD:{}", target.merge_ref);
    git_with_env_stdout_on_error(
        &root,
        &[
            "push",
            "--porcelain",
            target.remote.as_str(),
            refspec.as_str(),
        ],
        NONINTERACTIVE_GIT_ENV,
    )
    .map_err(map_push_error)?;
    verify_remote_ref_matches_head(&root, &target)?;

    git_write_response(&root)
}

#[tauri::command]
pub(crate) fn reset_hard_to_reflog(request: ResetHardToReflogRequest) -> Result<GitWriteResponse, String> {
    let root = repository_root(&request.path)?;
    let selector = normalize_reflog_selector(&request.selector)?;
    git(&root, &["reset", "--hard", selector.as_str()]).map_err(map_reset_error)?;
    git_write_response(&root)
}

fn ensure_staged_changes(root: &Path) -> Result<(), String> {
    let output = git(root, &["diff", "--cached", "--name-only", "--"])?;
    if output.lines().any(|line| !line.trim().is_empty()) {
        Ok(())
    } else {
        Err("No staged changes to commit".to_string())
    }
}

struct PushTarget {
    branch: String,
    remote: String,
    merge_ref: String,
    upstream_ref: String,
}

fn resolve_push_target(root: &Path) -> Result<PushTarget, String> {
    let branch = current_local_branch(root)?;
    let missing = format!("No upstream is configured for branch {branch}");
    let remote_key = format!("branch.{branch}.remote");
    let merge_key = format!("branch.{branch}.merge");
    let remote = git_config_value(root, &remote_key, &missing)?;
    let merge_ref = git_config_value(root, &merge_key, &missing)?;
    if remote == "." || !merge_ref.starts_with("refs/heads/") {
        return Err(missing);
    }
    let upstream_ref = git_trim(root, &["rev-parse", "--symbolic-full-name", "@{upstream}"])
        .map_err(|_| format!("No upstream is configured for branch {branch}"))?;

    Ok(PushTarget {
        branch,
        remote,
        merge_ref,
        upstream_ref,
    })
}

fn current_local_branch(root: &Path) -> Result<String, String> {
    match git_trim(root, &["symbolic-ref", "--quiet", "--short", "HEAD"]) {
        Ok(branch) if !branch.is_empty() => Ok(branch),
        Ok(_) | Err(_) => Err("Cannot push while HEAD is detached".to_string()),
    }
}

fn git_config_value(root: &Path, key: &str, missing: &str) -> Result<String, String> {
    let value = git_trim(root, &["config", "--get", key]).map_err(|_| missing.to_string())?;
    if value.is_empty() {
        Err(missing.to_string())
    } else {
        Ok(value)
    }
}

fn validate_push_state(root: &Path, target: &PushTarget) -> Result<(), String> {
    let (ahead, behind) = rev_list_ahead_behind(root, &target.upstream_ref)?;
    if ahead == 0 && behind == 0 {
        return Err(format!(
            "Branch {} has no local commits to push",
            target.branch
        ));
    }
    if ahead == 0 && behind > 0 {
        return Err(format!(
            "Branch {} is behind its upstream; pull before pushing",
            target.branch
        ));
    }
    if ahead > 0 && behind > 0 {
        return Err(format!(
            "Branch {} has diverged from its upstream; pull or rebase before pushing",
            target.branch
        ));
    }

    Ok(())
}

fn rev_list_ahead_behind(root: &Path, upstream_ref: &str) -> Result<(usize, usize), String> {
    let range = format!("HEAD...{upstream_ref}");
    let output = git(root, &["rev-list", "--left-right", "--count", &range])?;
    let mut parts = output.split_whitespace();
    let ahead = parse_rev_count(parts.next(), "ahead")?;
    let behind = parse_rev_count(parts.next(), "behind")?;
    Ok((ahead, behind))
}

fn parse_rev_count(value: Option<&str>, label: &str) -> Result<usize, String> {
    let raw = value.ok_or_else(|| format!("Git did not report {label} count"))?;
    raw.parse::<usize>()
        .map_err(|error| format!("Git reported invalid {label} count: {error}"))
}

fn verify_remote_ref_matches_head(root: &Path, target: &PushTarget) -> Result<(), String> {
    let head = git_trim(root, &["rev-parse", "HEAD"])?;
    let output = git_with_env(
        root,
        &[
            "ls-remote",
            "--exit-code",
            target.remote.as_str(),
            target.merge_ref.as_str(),
        ],
        NONINTERACTIVE_GIT_ENV,
    )
    .map_err(|error| format!("Failed to verify pushed upstream ref: {error}"))?;
    let remote_hash = remote_hash_for_ref(&output, &target.merge_ref)
        .ok_or_else(|| format!("Configured upstream {} was not found", target.merge_ref))?;
    if remote_hash == head {
        Ok(())
    } else {
        Err("Push completed but configured upstream does not match HEAD".to_string())
    }
}

fn remote_hash_for_ref(output: &str, expected_ref: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let ref_name = parts.next()?;
        (ref_name == expected_ref).then(|| hash.to_string())
    })
}

fn git_trim(root: &Path, args: &[&str]) -> Result<String, String> {
    Ok(git(root, args)?.trim().to_string())
}

fn normalize_reflog_selector(selector: &str) -> Result<String, String> {
    let trimmed = selector.trim();
    if trimmed.is_empty() {
        return Err("Reflog selector cannot be empty".to_string());
    }
    if trimmed.contains('\0') {
        return Err("Reflog selector cannot contain NUL bytes".to_string());
    }

    let Some(index) = trimmed
        .strip_prefix("HEAD@{")
        .and_then(|value| value.strip_suffix('}'))
    else {
        return Err("Only numeric HEAD reflog selectors are supported here".to_string());
    };

    if index.is_empty() || !index.chars().all(|character| character.is_ascii_digit()) {
        return Err("Only numeric HEAD reflog selectors are supported here".to_string());
    }

    Ok(trimmed.to_string())
}

fn map_commit_error(error: String) -> String {
    let lower = error.to_ascii_lowercase();
    if lower.contains("nothing to commit")
        || lower.contains("no changes added")
        || lower.contains("nothing added to commit")
    {
        "No staged changes to commit".to_string()
    } else if lower.contains("author identity unknown")
        || lower.contains("unable to auto-detect email address")
    {
        format!("Git identity is not configured: {error}")
    } else if lower.contains("gpg failed") || lower.contains("failed to sign") {
        format!("Commit signing failed: {error}")
    } else if lower.contains("hook declined")
        || lower.contains("pre-commit")
        || lower.contains("commit-msg")
    {
        format!("Commit was rejected by a Git hook: {error}")
    } else {
        format!("Failed to create commit: {error}")
    }
}

fn map_push_error(error: String) -> String {
    let lower = error.to_ascii_lowercase();
    if lower.contains("non-fast-forward")
        || lower.contains("fetch first")
        || lower.contains("stale info")
    {
        format!("Remote rejected push because it is not fast-forward; fetch or pull before pushing: {error}")
    } else if lower.contains("authentication")
        || lower.contains("could not read username")
        || lower.contains("terminal prompts disabled")
        || lower.contains("permission denied")
    {
        format!("Push authentication failed: {error}")
    } else if lower.contains("hook declined") || lower.contains("pre-receive hook declined") {
        format!("Push was rejected by a Git hook: {error}")
    } else {
        format!("Failed to push current branch: {error}")
    }
}

fn map_reset_error(error: String) -> String {
    let lower = error.to_ascii_lowercase();
    if lower.contains("unknown revision")
        || lower.contains("ambiguous argument")
        || lower.contains("log for")
    {
        format!("Reflog entry could not be resolved: {error}")
    } else {
        format!("Failed to reset to reflog entry: {error}")
    }
}

#[cfg(test)]
#[path = "git_commit_push_tests.rs"]
mod tests;
