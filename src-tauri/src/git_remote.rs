use serde::{Deserialize, Serialize};

use crate::git_write::{git_write_response, GitWriteResponse};
use crate::{blocking_command, git, git_with_env_stdout_on_error, repository_root};

const NONINTERACTIVE_REMOTE_ENV: &[(&str, &str)] = &[
    ("GIT_TERMINAL_PROMPT", "0"),
    ("GCM_INTERACTIVE", "never"),
    ("GCM_TERMINAL_PROMPT", "0"),
    ("SSH_ASKPASS_REQUIRE", "never"),
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteInfo {
    name: String,
    url: String,
    push_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListRemotesResponse {
    remotes: Vec<RemoteInfo>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddRemoteRequest {
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RenameRemoteRequest {
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) new_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteWriteRequest {
    pub(crate) path: String,
    pub(crate) name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetBranchUpstreamRequest {
    pub(crate) path: String,
    pub(crate) branch: String,
    pub(crate) upstream: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteRemoteBranchRequest {
    pub(crate) path: String,
    pub(crate) remote: String,
    pub(crate) branch: String,
}

#[tauri::command]
pub(crate) async fn list_remotes(path: String) -> Result<ListRemotesResponse, String> {
    blocking_command("list_remotes", move || {
        let root = repository_root(&path)?;
        let output = git(&root, &["remote"])?;
        let mut remotes = Vec::new();
        for name in output.lines().map(str::trim).filter(|name| !name.is_empty()) {
            let url = git(&root, &["remote", "get-url", name])?.trim().to_string();
            let push_url = git(&root, &["remote", "get-url", "--push", name])?
                .trim()
                .to_string();
            remotes.push(RemoteInfo {
                name: name.to_string(),
                url,
                push_url,
            });
        }
        Ok(ListRemotesResponse { remotes })
    })
    .await
}

#[tauri::command]
pub(crate) async fn add_remote(request: AddRemoteRequest) -> Result<GitWriteResponse, String> {
    blocking_command("add_remote", move || {
        let root = repository_root(&request.path)?;
        let name = normalize_remote_name(&request.name)?;
        let url = normalize_remote_url(&request.url)?;
        git(&root, &["remote", "add", name.as_str(), url.as_str()])
            .map_err(map_remote_error)?;
        git_write_response(&root)
    })
    .await
}

#[tauri::command]
pub(crate) async fn rename_remote(
    request: RenameRemoteRequest,
) -> Result<GitWriteResponse, String> {
    blocking_command("rename_remote", move || {
        let root = repository_root(&request.path)?;
        let name = normalize_remote_name(&request.name)?;
        let new_name = normalize_remote_name(&request.new_name)?;
        git(&root, &["remote", "rename", name.as_str(), new_name.as_str()])
            .map_err(map_remote_error)?;
        git_write_response(&root)
    })
    .await
}

#[tauri::command]
pub(crate) async fn remove_remote(
    request: RemoteWriteRequest,
) -> Result<GitWriteResponse, String> {
    blocking_command("remove_remote", move || {
        let root = repository_root(&request.path)?;
        let name = normalize_remote_name(&request.name)?;
        git(&root, &["remote", "remove", name.as_str()]).map_err(map_remote_error)?;
        git_write_response(&root)
    })
    .await
}

#[tauri::command]
pub(crate) async fn set_branch_upstream(
    request: SetBranchUpstreamRequest,
) -> Result<GitWriteResponse, String> {
    blocking_command("set_branch_upstream", move || {
        let root = repository_root(&request.path)?;
        let branch = normalize_local_branch_name(&request.branch)?;
        let upstream = normalize_upstream_name(&request.upstream)?;
        git(
            &root,
            &[
                "branch",
                "--set-upstream-to",
                upstream.as_str(),
                branch.as_str(),
            ],
        )
        .map_err(map_remote_error)?;
        git_write_response(&root)
    })
    .await
}

#[tauri::command]
pub(crate) async fn delete_remote_branch(
    request: DeleteRemoteBranchRequest,
) -> Result<GitWriteResponse, String> {
    blocking_command("delete_remote_branch", move || {
        let root = repository_root(&request.path)?;
        let remote = normalize_remote_name(&request.remote)?;
        let branch = normalize_remote_branch_name(&request.branch, &remote)?;
        let refspec = format!(":refs/heads/{branch}");
        git_with_env_stdout_on_error(
            &root,
            &["push", "--porcelain", remote.as_str(), refspec.as_str()],
            NONINTERACTIVE_REMOTE_ENV,
        )
        .map_err(map_remote_push_error)?;
        git_write_response(&root)
    })
    .await
}

fn normalize_remote_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Remote name cannot be empty".to_string());
    }
    if trimmed.contains('\0') {
        return Err("Remote name cannot contain NUL bytes".to_string());
    }
    if trimmed.starts_with('-') || trimmed.chars().any(char::is_whitespace) {
        return Err(format!("Invalid remote name {trimmed}"));
    }
    Ok(trimmed.to_string())
}

fn normalize_remote_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("Remote URL cannot be empty".to_string());
    }
    if trimmed.contains('\0') {
        return Err("Remote URL cannot contain NUL bytes".to_string());
    }
    Ok(trimmed.to_string())
}

fn normalize_local_branch_name(branch: &str) -> Result<String, String> {
    let trimmed = branch.trim().strip_prefix("refs/heads/").unwrap_or(branch.trim());
    if trimmed.is_empty() {
        return Err("Branch name cannot be empty".to_string());
    }
    if trimmed.contains('\0') || trimmed.starts_with('-') || trimmed.chars().any(char::is_whitespace)
    {
        return Err(format!("Invalid branch name {trimmed}"));
    }
    Ok(trimmed.to_string())
}

fn normalize_upstream_name(upstream: &str) -> Result<String, String> {
    let trimmed = upstream
        .trim()
        .strip_prefix("refs/remotes/")
        .unwrap_or(upstream.trim());
    if trimmed.is_empty() || !trimmed.contains('/') {
        return Err("Upstream must include a remote and branch".to_string());
    }
    if trimmed.contains('\0') || trimmed.starts_with('-') || trimmed.chars().any(char::is_whitespace)
    {
        return Err(format!("Invalid upstream {trimmed}"));
    }
    Ok(trimmed.to_string())
}

fn normalize_remote_branch_name(branch: &str, remote: &str) -> Result<String, String> {
    let trimmed = branch.trim();
    let without_ref = trimmed
        .strip_prefix("refs/heads/")
        .or_else(|| trimmed.strip_prefix(&format!("refs/remotes/{remote}/")))
        .unwrap_or(trimmed);
    if without_ref.is_empty() {
        return Err("Remote branch name cannot be empty".to_string());
    }
    if without_ref.contains('\0')
        || without_ref.starts_with('-')
        || without_ref.chars().any(char::is_whitespace)
    {
        return Err(format!("Invalid remote branch {without_ref}"));
    }
    Ok(without_ref.to_string())
}

fn map_remote_error(error: String) -> String {
    format!("Git remote operation failed: {error}")
}

fn map_remote_push_error(error: String) -> String {
    let lower = error.to_ascii_lowercase();
    if lower.contains("rejected") {
        format!("Remote branch deletion was rejected: {error}")
    } else {
        format!("Failed to update remote branch: {error}")
    }
}

#[cfg(test)]
#[path = "git_remote_tests.rs"]
mod tests;
