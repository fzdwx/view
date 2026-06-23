use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CommitTrackingSide {
    Local,
    Upstream,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitTrackingInfo {
    pub(crate) side: CommitTrackingSide,
    pub(crate) label: String,
    pub(crate) compare_label: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CommitTrackingSelection {
    pub(crate) left_ref: String,
    pub(crate) right_ref: String,
    local_label: String,
    upstream_label: String,
}

pub(crate) fn tracking_selection_for_target<F>(
    root: &Path,
    branch: Option<&str>,
    mut git: F,
) -> Option<CommitTrackingSelection>
where
    F: FnMut(&Path, &[&str]) -> Result<String, String>,
{
    let target_ref = normalize_target_ref(root, branch.and_then(non_empty)?, &mut git)?;

    if target_ref.starts_with("refs/remotes/") {
        return remote_tracking_selection(root, &target_ref, &mut git);
    }

    None
}

pub(crate) fn commit_tracking_map<F>(
    root: &Path,
    selection: &CommitTrackingSelection,
    mut git: F,
) -> Result<HashMap<String, CommitTrackingInfo>, String>
where
    F: FnMut(&Path, &[&str]) -> Result<String, String>,
{
    let range = format!("{}...{}", selection.left_ref, selection.right_ref);
    let output = git(root, &["rev-list", "--left-right", &range])?;
    let mut map = HashMap::new();

    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(hash) = trimmed.strip_prefix('<') {
            map.insert(
                hash.to_string(),
                CommitTrackingInfo {
                    side: CommitTrackingSide::Local,
                    label: selection.local_label.clone(),
                    compare_label: selection.upstream_label.clone(),
                },
            );
        } else if let Some(hash) = trimmed.strip_prefix('>') {
            map.insert(
                hash.to_string(),
                CommitTrackingInfo {
                    side: CommitTrackingSide::Upstream,
                    label: selection.upstream_label.clone(),
                    compare_label: selection.local_label.clone(),
                },
            );
        }
    }

    Ok(map)
}

fn remote_tracking_selection<F>(
    root: &Path,
    remote_ref: &str,
    git: &mut F,
) -> Option<CommitTrackingSelection>
where
    F: FnMut(&Path, &[&str]) -> Result<String, String>,
{
    let local_ref = local_ref_for_remote(root, remote_ref, git)?;
    Some(CommitTrackingSelection {
        left_ref: local_ref.clone(),
        right_ref: remote_ref.to_string(),
        local_label: ref_label(&local_ref)?,
        upstream_label: ref_label(remote_ref)?,
    })
}

fn normalize_target_ref<F>(root: &Path, target: &str, git: &mut F) -> Option<String>
where
    F: FnMut(&Path, &[&str]) -> Result<String, String>,
{
    if target.starts_with("refs/") {
        return Some(target.to_string());
    }

    let output = git(root, &["rev-parse", "--symbolic-full-name", target]).ok()?;
    non_empty(output.trim()).map(str::to_string)
}

fn local_ref_for_remote<F>(root: &Path, remote_ref: &str, git: &mut F) -> Option<String>
where
    F: FnMut(&Path, &[&str]) -> Result<String, String>,
{
    let remote_label = ref_label(remote_ref)?;
    let (_, branch_path) = remote_label.split_once('/')?;
    let local_ref = format!("refs/heads/{branch_path}");
    git(root, &["show-ref", "--verify", "--quiet", &local_ref])
        .is_ok()
        .then_some(local_ref)
}

fn ref_label(ref_name: &str) -> Option<String> {
    ref_name
        .strip_prefix("refs/heads/")
        .or_else(|| ref_name.strip_prefix("refs/remotes/"))
        .filter(|label| !label.trim().is_empty())
        .map(str::to_string)
}

fn non_empty(value: &str) -> Option<&str> {
    (!value.trim().is_empty()).then_some(value)
}
