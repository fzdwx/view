use serde::{Deserialize, Serialize};

use crate::{blocking_command, git, repository_root};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GetCommitDetailsRequest {
    pub(crate) path: String,
    pub(crate) commit: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitSignature {
    pub(crate) status: String,
    pub(crate) summary: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitDetails {
    pub(crate) hash: String,
    pub(crate) subject: String,
    pub(crate) body: String,
    pub(crate) message: String,
    pub(crate) parents: Vec<String>,
    pub(crate) refs: Vec<String>,
    pub(crate) signature: CommitSignature,
    pub(crate) compare_base: Option<String>,
}

#[tauri::command]
pub(crate) async fn get_commit_details(
    request: GetCommitDetailsRequest,
) -> Result<CommitDetails, String> {
    blocking_command("get_commit_details", move || {
        let root = repository_root(&request.path)?;
        let commit = resolve_commit(&root, &request.commit)?;
        let output = git(
            &root,
            &["show", "-s", "--format=%H%x1f%P%x1f%B", commit.as_str()],
        )?;
        let mut parts = output.splitn(3, '\x1f');
        let hash = parts.next().unwrap_or_default().trim().to_string();
        let parents = parts
            .next()
            .unwrap_or_default()
            .split_whitespace()
            .map(str::to_string)
            .collect::<Vec<_>>();
        let message = parts.next().unwrap_or_default().trim_end().to_string();
        let subject = message.lines().next().unwrap_or_default().to_string();
        let body = commit_message_body(&message);
        let refs = commit_refs(&root, &hash)?;
        let signature = commit_signature(&root, &hash);
        let compare_base = parents.first().cloned();

        Ok(CommitDetails {
            hash,
            subject,
            body,
            message,
            parents,
            refs,
            signature,
            compare_base,
        })
    })
    .await
}

fn resolve_commit(root: &std::path::Path, commit: &str) -> Result<String, String> {
    let trimmed = commit.trim();
    if trimmed.is_empty() {
        return Err("Commit is required".to_string());
    }
    if trimmed.contains('\0') || trimmed.starts_with('-') || trimmed.chars().any(char::is_whitespace)
    {
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

fn commit_message_body(message: &str) -> String {
    let mut lines = message.lines();
    let _subject = lines.next();
    let body = lines.collect::<Vec<_>>().join("\n");
    body.trim().to_string()
}

fn commit_refs(root: &std::path::Path, hash: &str) -> Result<Vec<String>, String> {
    let output = git(
        root,
        &[
            "for-each-ref",
            "--format=%(refname)",
            "--points-at",
            hash,
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
    )?;
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect())
}

fn commit_signature(root: &std::path::Path, hash: &str) -> CommitSignature {
    match git(root, &["verify-commit", hash]) {
        Ok(output) => CommitSignature {
            status: "valid".to_string(),
            summary: output.trim().to_string(),
        },
        Err(error) => {
            let lower = error.to_ascii_lowercase();
            let status = if lower.contains("no signature")
                || lower.contains("gpg")
                || lower == "git command failed"
            {
                "unsigned"
            } else {
                "unknown"
            };
            CommitSignature {
                status: status.to_string(),
                summary: error,
            }
        }
    }
}

#[cfg(test)]
#[path = "git_commit_details_tests.rs"]
mod tests;
