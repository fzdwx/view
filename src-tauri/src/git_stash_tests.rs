use super::{
    apply_stash as async_apply_stash, create_stash as async_create_stash,
    drop_stash as async_drop_stash, get_stash_diff as async_get_stash_diff,
    list_stashes as async_list_stashes, pop_stash as async_pop_stash, CreateStashRequest,
    StashListResponse, StashRequest,
};
use crate::git_write::GitWriteResponse;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn list_stashes(path: String) -> Result<StashListResponse, String> {
    tauri::async_runtime::block_on(async_list_stashes(path))
}

fn create_stash(request: CreateStashRequest) -> Result<GitWriteResponse, String> {
    tauri::async_runtime::block_on(async_create_stash(request))
}

fn apply_stash(request: StashRequest) -> Result<GitWriteResponse, String> {
    tauri::async_runtime::block_on(async_apply_stash(request))
}

fn pop_stash(request: StashRequest) -> Result<GitWriteResponse, String> {
    tauri::async_runtime::block_on(async_pop_stash(request))
}

fn drop_stash(request: StashRequest) -> Result<GitWriteResponse, String> {
    tauri::async_runtime::block_on(async_drop_stash(request))
}

fn get_stash_diff(path: String, selector: String) -> Result<String, String> {
    tauri::async_runtime::block_on(async_get_stash_diff(path, selector))
}

#[test]
fn create_stash_shelves_tracked_and_untracked_changes() {
    let repo = create_repo_with_tracked_file("stash-create");
    fs::write(repo.join("tracked.txt"), "stashed\n").expect("modify tracked");
    fs::write(repo.join("new.txt"), "new\n").expect("write untracked");

    let response = create_stash(create_stash_request(path_string(&repo), "shelf work", true))
        .expect("create stash");
    let stashes = list_stashes(path_string(&repo)).expect("list stashes");

    assert!(git_status(&repo).trim().is_empty());
    assert!(response.files.is_empty());
    assert_eq!(stashes.entries.len(), 1);
    assert_eq!(stashes.entries[0].selector, "stash@{0}");
    assert_eq!(stashes.entries[0].branch, "main");
    assert!(stashes.entries[0].message.contains("shelf work"));
}

#[test]
fn stash_diff_shows_shelved_patch() {
    let repo = create_repo_with_tracked_file("stash-diff");
    fs::write(repo.join("tracked.txt"), "stashed\n").expect("modify tracked");
    create_stash(create_stash_request(path_string(&repo), "diffable", false))
        .expect("create stash");

    let diff = get_stash_diff(path_string(&repo), "stash@{0}".to_string()).expect("stash diff");

    assert!(diff.contains("diff --git a/tracked.txt b/tracked.txt"));
    assert!(diff.contains("+stashed"));
}

#[test]
fn apply_stash_restores_changes_without_dropping_entry() {
    let repo = create_repo_with_tracked_file("stash-apply");
    fs::write(repo.join("tracked.txt"), "stashed\n").expect("modify tracked");
    create_stash(create_stash_request(path_string(&repo), "apply me", false))
        .expect("create stash");

    let response =
        apply_stash(stash_request(path_string(&repo), "stash@{0}")).expect("apply stash");
    let stashes = list_stashes(path_string(&repo)).expect("list stashes");

    assert!(git_status(&repo).starts_with(" M tracked.txt"));
    assert_eq!(stashes.entries.len(), 1);
    assert!(response
        .files
        .iter()
        .any(|file| file.path == "tracked.txt" && file.unstaged));
}

#[test]
fn pop_stash_restores_changes_and_removes_entry() {
    let repo = create_repo_with_tracked_file("stash-pop");
    fs::write(repo.join("tracked.txt"), "stashed\n").expect("modify tracked");
    create_stash(create_stash_request(path_string(&repo), "pop me", false)).expect("create stash");

    pop_stash(stash_request(path_string(&repo), "stash@{0}")).expect("pop stash");
    let stashes = list_stashes(path_string(&repo)).expect("list stashes");

    assert!(git_status(&repo).starts_with(" M tracked.txt"));
    assert!(stashes.entries.is_empty());
}

#[test]
fn drop_stash_removes_entry_without_touching_worktree() {
    let repo = create_repo_with_tracked_file("stash-drop");
    fs::write(repo.join("tracked.txt"), "stashed\n").expect("modify tracked");
    create_stash(create_stash_request(path_string(&repo), "drop me", false)).expect("create stash");

    drop_stash(stash_request(path_string(&repo), "stash@{0}")).expect("drop stash");
    let stashes = list_stashes(path_string(&repo)).expect("list stashes");

    assert!(git_status(&repo).trim().is_empty());
    assert!(stashes.entries.is_empty());
}

#[test]
fn stash_selector_rejects_revision_injection() {
    let repo = create_repo_with_tracked_file("stash-selector");

    let error = match get_stash_diff(path_string(&repo), "stash@{0} -- tracked.txt".to_string()) {
        Ok(_) => panic!("invalid selector should fail"),
        Err(error) => error,
    };

    assert!(error.contains("numeric stash selector"));
}

fn create_stash_request(
    path: String,
    message: &str,
    include_untracked: bool,
) -> CreateStashRequest {
    CreateStashRequest {
        path,
        message: message.to_string(),
        include_untracked,
    }
}

fn stash_request(path: String, selector: &str) -> StashRequest {
    StashRequest {
        path,
        selector: selector.to_string(),
    }
}

fn create_repo_with_tracked_file(prefix: &str) -> PathBuf {
    let repo = unique_temp_repo_path(prefix);
    fs::create_dir_all(&repo).expect("create temp repo");
    run_git(&repo, &["init", "--initial-branch=main"]);
    run_git(&repo, &["config", "user.email", "view@example.test"]);
    run_git(&repo, &["config", "user.name", "View Test"]);
    fs::write(repo.join("tracked.txt"), "base\n").expect("write tracked");
    run_git(&repo, &["add", "tracked.txt"]);
    run_git(&repo, &["commit", "-m", "base"]);
    repo
}

fn unique_temp_repo_path(prefix: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    env::temp_dir().join(format!(
        "view-git-stash-{prefix}-{}-{nanos}",
        std::process::id()
    ))
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn git_status(repo: &Path) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["status", "--porcelain=v1", "-uall", "--renames"])
        .output()
        .expect("run git status");
    if !output.status.success() {
        panic!(
            "git status failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    String::from_utf8_lossy(&output.stdout).to_string()
}

fn run_git(repo: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .unwrap_or_else(|error| panic!("failed to run git {args:?}: {error}"));
    if !output.status.success() {
        panic!(
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}
