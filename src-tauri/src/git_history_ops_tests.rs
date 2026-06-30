use super::{
    cherry_pick_commit as async_cherry_pick_commit, revert_commit as async_revert_commit,
    CommitHashRequest,
};
use crate::git_write::GitWriteResponse;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn cherry_pick_commit(request: CommitHashRequest) -> Result<GitWriteResponse, String> {
    tauri::async_runtime::block_on(async_cherry_pick_commit(request))
}

fn revert_commit(request: CommitHashRequest) -> Result<GitWriteResponse, String> {
    tauri::async_runtime::block_on(async_revert_commit(request))
}

fn commit_request(repo: &std::path::Path, commit: &str) -> CommitHashRequest {
    CommitHashRequest {
        path: repo.to_string_lossy().to_string(),
        commit: commit.to_string(),
    }
}

struct TempRepo {
    path: PathBuf,
}

impl TempRepo {
    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempRepo {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.path).ok();
    }
}

fn create_repo_with_tracked_file(prefix: &str) -> TempRepo {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let repo = TempRepo {
        path: std::env::temp_dir().join(format!(
            "view-{prefix}-{}-{nanos}",
            std::process::id()
        )),
    };
    fs::create_dir_all(repo.path()).expect("create temp repo");
    run_git(repo.path(), &["init", "--initial-branch=main"]);
    run_git(repo.path(), &["config", "user.email", "view@example.test"]);
    run_git(repo.path(), &["config", "user.name", "View Test"]);
    fs::write(repo.path().join("tracked.txt"), "base\n").expect("write tracked");
    run_git(repo.path(), &["add", "tracked.txt"]);
    run_git(repo.path(), &["commit", "-m", "base"]);
    repo
}

fn git_head(repo: &Path) -> String {
    run_git(repo, &["rev-parse", "HEAD"])
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

#[test]
fn cherry_pick_commit_applies_selected_commit_to_current_branch() {
    let repo = create_repo_with_tracked_file("history-cherry-pick");

    run_git(repo.path(), &["checkout", "-b", "feature"]);
    fs::write(repo.path().join("feature.txt"), "feature\n").expect("write feature");
    run_git(repo.path(), &["add", "feature.txt"]);
    run_git(repo.path(), &["commit", "-m", "feature commit"]);
    let feature_hash = git_head(repo.path());
    run_git(repo.path(), &["checkout", "main"]);

    let response =
        cherry_pick_commit(commit_request(repo.path(), &feature_hash)).expect("cherry-pick");

    assert_eq!(
        fs::read_to_string(repo.path().join("feature.txt")).expect("read picked file"),
        "feature\n"
    );
    assert!(git_head(repo.path()).starts_with(&response.summary.head));
    assert!(response.files.is_empty());
    assert!(run_git(repo.path(), &["log", "-1", "--pretty=%s"]).contains("feature commit"));
}

#[test]
fn revert_commit_creates_inverse_commit_without_opening_editor() {
    let repo = create_repo_with_tracked_file("history-revert");

    fs::write(repo.path().join("tracked.txt"), "changed\n").expect("modify tracked");
    run_git(repo.path(), &["commit", "-am", "change tracked"]);
    let change_hash = git_head(repo.path());

    let response = revert_commit(commit_request(repo.path(), &change_hash)).expect("revert");

    assert_eq!(
        fs::read_to_string(repo.path().join("tracked.txt")).expect("read reverted file"),
        "base\n"
    );
    assert!(git_head(repo.path()).starts_with(&response.summary.head));
    assert!(response.files.is_empty());
    assert!(run_git(repo.path(), &["log", "-1", "--pretty=%s"]).contains("Revert"));
}

#[test]
fn history_operation_rejects_empty_commit_selector() {
    let repo = create_repo_with_tracked_file("history-empty");

    let error = match cherry_pick_commit(commit_request(repo.path(), " \t\n ")) {
        Ok(_) => panic!("empty commit should be rejected"),
        Err(error) => error,
    };

    assert!(error.contains("Commit is required"));
    assert_eq!(run_git(repo.path(), &["status", "--porcelain=v1"]), "");
}
