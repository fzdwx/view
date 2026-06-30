use serde::Deserialize;
use std::path::Path;

use crate::git_write::{git_write_response, GitWriteResponse};
use crate::{blocking_command, git, git_with_env_stdout_on_error, repository_root};

const NONINTERACTIVE_TAG_ENV: &[(&str, &str)] = &[
    ("GIT_TERMINAL_PROMPT", "0"),
    ("GCM_INTERACTIVE", "never"),
    ("GCM_TERMINAL_PROMPT", "0"),
    ("SSH_ASKPASS_REQUIRE", "never"),
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateTagRequest {
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) target: String,
    pub(crate) message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeleteTagRequest {
    pub(crate) path: String,
    pub(crate) name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PushTagRequest {
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) remote: String,
}

#[tauri::command]
pub(crate) async fn create_tag(request: CreateTagRequest) -> Result<GitWriteResponse, String> {
    blocking_command("create_tag", move || {
        let root = repository_root(&request.path)?;
        let name = normalize_tag_name(&root, &request.name)?;
        let target = resolve_tag_target(&root, &request.target)?;
        let message = request.message.trim();
        if request.message.contains('\0') {
            return Err("Tag message cannot contain NUL bytes".to_string());
        }

        if message.is_empty() {
            git(&root, &["tag", name.as_str(), target.as_str()]).map_err(map_tag_error)?;
        } else {
            git(
                &root,
                &["tag", "-a", name.as_str(), target.as_str(), "-m", message],
            )
            .map_err(map_tag_error)?;
        }

        git_write_response(&root)
    })
    .await
}

#[tauri::command]
pub(crate) async fn delete_tag(request: DeleteTagRequest) -> Result<GitWriteResponse, String> {
    blocking_command("delete_tag", move || {
        let root = repository_root(&request.path)?;
        let name = normalize_tag_name(&root, &request.name)?;
        git(&root, &["tag", "-d", name.as_str()]).map_err(map_tag_error)?;
        git_write_response(&root)
    })
    .await
}

#[tauri::command]
pub(crate) async fn push_tag(request: PushTagRequest) -> Result<GitWriteResponse, String> {
    blocking_command("push_tag", move || {
        let root = repository_root(&request.path)?;
        let name = normalize_tag_name(&root, &request.name)?;
        let remote = normalize_remote_name(&request.remote)?;
        git(&root, &["remote", "get-url", remote.as_str()])
            .map_err(|_| format!("Remote {remote} does not exist"))?;
        let refspec = format!("refs/tags/{name}:refs/tags/{name}");
        git_with_env_stdout_on_error(
            &root,
            &["push", "--porcelain", remote.as_str(), refspec.as_str()],
            NONINTERACTIVE_TAG_ENV,
        )
        .map_err(map_tag_push_error)?;
        git_write_response(&root)
    })
    .await
}

fn normalize_tag_name(root: &Path, name: &str) -> Result<String, String> {
    let trimmed = name
        .trim()
        .strip_prefix("refs/tags/")
        .unwrap_or_else(|| name.trim());
    if trimmed.is_empty() {
        return Err("Tag name cannot be empty".to_string());
    }
    if trimmed.contains('\0') {
        return Err("Tag name cannot contain NUL bytes".to_string());
    }
    if trimmed.starts_with('-') {
        return Err(format!("Invalid tag name {trimmed}"));
    }

    let ref_name = format!("refs/tags/{trimmed}");
    git(root, &["check-ref-format", ref_name.as_str()])
        .map_err(|_| format!("Invalid tag name {trimmed}"))?;
    Ok(trimmed.to_string())
}

fn resolve_tag_target(root: &Path, target: &str) -> Result<String, String> {
    let trimmed = target.trim();
    let target = if trimmed.is_empty() { "HEAD" } else { trimmed };
    if target.contains('\0') {
        return Err("Tag target cannot contain NUL bytes".to_string());
    }
    if target.starts_with('-') || target.chars().any(char::is_whitespace) {
        return Err("Tag target must be a single revision".to_string());
    }

    let spec = format!("{target}^{{commit}}");
    let output = git(root, &["rev-parse", "--verify", "--quiet", spec.as_str()])
        .map_err(|_| format!("Tag target {target} could not be resolved"))?;
    let hash = output.trim();
    if hash.is_empty() {
        return Err(format!("Tag target {target} could not be resolved"));
    }
    Ok(hash.to_string())
}

fn normalize_remote_name(remote: &str) -> Result<String, String> {
    let trimmed = remote.trim();
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

fn map_tag_error(error: String) -> String {
    let lower = error.to_ascii_lowercase();
    if lower.contains("already exists") {
        format!("Tag already exists: {error}")
    } else if lower.contains("not found") || lower.contains("not a valid") {
        format!("Git tag target is invalid: {error}")
    } else {
        format!("Git tag failed: {error}")
    }
}

fn map_tag_push_error(error: String) -> String {
    let lower = error.to_ascii_lowercase();
    if lower.contains("authentication") || lower.contains("could not read username") {
        format!("Git tag push requires credentials: {error}")
    } else if lower.contains("rejected") {
        format!("Git tag push was rejected: {error}")
    } else {
        format!("Git tag push failed: {error}")
    }
}

#[cfg(test)]
#[path = "git_tag_tests.rs"]
mod tests;
