use super::git_log;
use super::git_tracking::CommitTrackingSide;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn git_log_does_not_mark_tracking_when_selected_branch_is_local() {
    // Given: a cloned branch has one local-only commit and one fetched upstream-only commit.
    let remote = create_basic_repo("tracking-remote");
    write_repo_file(&remote, "base.txt", "base\n");
    run_git(&remote, &["add", "base.txt"]);
    run_git(&remote, &["commit", "-m", "base"]);

    let clone = unique_temp_repo_path("tracking-clone");
    run_git_global(&[
        "clone",
        remote.to_string_lossy().as_ref(),
        clone.to_string_lossy().as_ref(),
    ]);
    configure_user(&clone);

    write_repo_file(&clone, "local.txt", "local\n");
    run_git(&clone, &["add", "local.txt"]);
    run_git(&clone, &["commit", "-m", "local work"]);

    write_repo_file(&remote, "remote.txt", "remote\n");
    run_git(&remote, &["add", "remote.txt"]);
    run_git(&remote, &["commit", "-m", "remote work"]);
    run_git(&clone, &["fetch", "--all", "--prune"]);

    // When: the local branch log is loaded.
    let commits = git_log(&clone, Some("refs/heads/main"), None).expect("tracked git log");

    // Then: only the local branch history is visible and no row carries tracking metadata.
    let local = commits
        .iter()
        .find(|commit| commit.subject == "local work")
        .expect("local-only commit");
    assert!(local.tracking.is_none());

    assert!(commits
        .iter()
        .find(|commit| commit.subject == "remote work")
        .is_none());

    let base = commits
        .iter()
        .find(|commit| commit.subject == "base")
        .expect("shared base commit");
    assert!(base.tracking.is_none());

    fs::remove_dir_all(remote).ok();
    fs::remove_dir_all(clone).ok();
}

#[test]
fn git_log_marks_tracking_commits_when_selected_branch_is_remote() {
    // Given: a remote branch has a matching local branch with divergent commits.
    let remote = create_basic_repo("tracking-remote-selected");
    write_repo_file(&remote, "base.txt", "base\n");
    run_git(&remote, &["add", "base.txt"]);
    run_git(&remote, &["commit", "-m", "base"]);

    let clone = unique_temp_repo_path("tracking-remote-selected-clone");
    run_git_global(&[
        "clone",
        remote.to_string_lossy().as_ref(),
        clone.to_string_lossy().as_ref(),
    ]);
    configure_user(&clone);

    write_repo_file(&clone, "local.txt", "local\n");
    run_git(&clone, &["add", "local.txt"]);
    run_git(&clone, &["commit", "-m", "local work"]);

    write_repo_file(&remote, "remote.txt", "remote\n");
    run_git(&remote, &["add", "remote.txt"]);
    run_git(&remote, &["commit", "-m", "remote work"]);
    run_git(&clone, &["fetch", "--all", "--prune"]);

    // When: the matching remote branch log is loaded.
    let commits =
        git_log(&clone, Some("refs/remotes/origin/main"), None).expect("remote branch git log");

    // Then: the row markers still compare origin/main to the local main branch.
    let local_tracking = commits
        .iter()
        .find(|commit| commit.subject == "local work")
        .and_then(|commit| commit.tracking.as_ref())
        .expect("local tracking");
    assert_eq!(local_tracking.side, CommitTrackingSide::Local);
    assert_eq!(local_tracking.label, "main");

    let upstream_tracking = commits
        .iter()
        .find(|commit| commit.subject == "remote work")
        .and_then(|commit| commit.tracking.as_ref())
        .expect("upstream tracking");
    assert_eq!(upstream_tracking.side, CommitTrackingSide::Upstream);
    assert_eq!(upstream_tracking.label, "origin/main");

    fs::remove_dir_all(remote).ok();
    fs::remove_dir_all(clone).ok();
}

fn create_basic_repo(prefix: &str) -> PathBuf {
    let repo = unique_temp_repo_path(prefix);
    fs::create_dir_all(&repo).expect("create temp repo");
    run_git(&repo, &["init", "--initial-branch=main"]);
    configure_user(&repo);
    repo
}

fn configure_user(repo: &Path) {
    run_git(repo, &["config", "user.email", "view@example.test"]);
    run_git(repo, &["config", "user.name", "View Test"]);
}

fn unique_temp_repo_path(prefix: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    env::temp_dir().join(format!("view-{prefix}-{}-{nanos}", std::process::id()))
}

fn write_repo_file(repo: &Path, file_path: &str, contents: &str) {
    let full_path = repo.join(file_path);
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).expect("create parent directories");
    }
    fs::write(full_path, contents).expect("write repo file");
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

fn run_git_global(args: &[&str]) -> String {
    let output = Command::new("git")
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
