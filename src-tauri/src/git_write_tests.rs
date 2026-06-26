use super::{
    apply_file_change as async_apply_file_change,
    mark_conflicts_resolved as async_mark_conflicts_resolved, stage_files as async_stage_files,
    unstage_files as async_unstage_files, GitChangeOperation, GitChangeSource,
    GitFileChangeRequest, GitPathsRequest, GitWriteResponse,
};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[path = "git_test_evidence.rs"]
mod test_evidence;

fn stage_files(request: GitPathsRequest) -> Result<GitWriteResponse, String> {
    tauri::async_runtime::block_on(async_stage_files(request))
}

fn unstage_files(request: GitPathsRequest) -> Result<GitWriteResponse, String> {
    tauri::async_runtime::block_on(async_unstage_files(request))
}

fn apply_file_change(request: GitFileChangeRequest) -> Result<GitWriteResponse, String> {
    tauri::async_runtime::block_on(async_apply_file_change(request))
}

fn mark_conflicts_resolved(request: GitPathsRequest) -> Result<GitWriteResponse, String> {
    tauri::async_runtime::block_on(async_mark_conflicts_resolved(request))
}

#[test]
fn stage_files_stages_modified_file() {
    let repo = create_repo_with_tracked_file();
    fs::write(repo.join("tracked.txt"), "changed\n").expect("modify tracked");
    let before = git_status(&repo);

    let response = stage_files(request(&repo, ["tracked.txt"])).expect("stage modified file");

    let after = git_status(&repo);
    write_evidence("stage modified", &before, &after);
    assert!(after.starts_with("M  tracked.txt"));
    assert!(response
        .files
        .iter()
        .any(|file| file.path == "tracked.txt" && file.staged && !file.unstaged));
    fs::remove_dir_all(repo).ok();
}

#[test]
fn stage_files_stages_untracked_file() {
    let repo = create_repo_with_tracked_file();
    fs::write(repo.join("new.txt"), "new\n").expect("write untracked");
    let before = git_status(&repo);

    let response = stage_files(request(&repo, ["new.txt"])).expect("stage untracked file");

    let after = git_status(&repo);
    write_evidence("stage untracked", &before, &after);
    assert!(after.starts_with("A  new.txt"));
    assert!(response
        .files
        .iter()
        .any(|file| file.path == "new.txt" && file.staged && !file.untracked));
    fs::remove_dir_all(repo).ok();
}

#[test]
fn stage_files_stages_deleted_file() {
    let repo = create_repo_with_tracked_file();
    fs::remove_file(repo.join("tracked.txt")).expect("delete tracked");
    let before = git_status(&repo);

    let response = stage_files(request(&repo, ["tracked.txt"])).expect("stage deletion");

    let after = git_status(&repo);
    write_evidence("stage deletion", &before, &after);
    assert!(after.starts_with("D  tracked.txt"));
    assert!(response
        .files
        .iter()
        .any(|file| file.path == "tracked.txt" && file.deleted && file.staged));
    fs::remove_dir_all(repo).ok();
}

#[test]
fn stage_files_stages_simple_renamed_file_when_new_path_requested() {
    let repo = create_repo_with_tracked_file();
    fs::rename(repo.join("tracked.txt"), repo.join("renamed.txt")).expect("rename tracked file");
    let before = git_status(&repo);

    let response = stage_files(request(&repo, ["renamed.txt"])).expect("stage renamed file");

    let after = git_status(&repo);
    write_evidence("stage renamed", &before, &after);
    assert!(
        !after.contains(" D tracked.txt"),
        "after status should not leave an unstaged deletion:\n{after}"
    );
    assert!(
        !after.contains("?? renamed.txt"),
        "after status should not leave an untracked rename target:\n{after}"
    );
    assert!(
        after.starts_with("R  ")
            || (after.contains("D  tracked.txt") && after.contains("A  renamed.txt")),
        "after status should stage both sides of the rename:\n{after}"
    );
    assert!(response
        .files
        .iter()
        .any(|file| file.path == "renamed.txt" && file.staged && !file.unstaged));
    assert!(!response
        .files
        .iter()
        .any(|file| file.path == "tracked.txt" && file.unstaged));
    fs::remove_dir_all(repo).ok();
}

#[test]
fn unstage_files_unstages_staged_file() {
    let repo = create_repo_with_tracked_file();
    fs::write(repo.join("tracked.txt"), "changed\n").expect("modify tracked");
    run_git(&repo, &["add", "tracked.txt"]);
    let before = git_status(&repo);

    let response = unstage_files(request(&repo, ["tracked.txt"])).expect("unstage file");

    let after = git_status(&repo);
    write_evidence("unstage staged", &before, &after);
    assert!(after.starts_with(" M tracked.txt"));
    assert!(response
        .files
        .iter()
        .any(|file| file.path == "tracked.txt" && !file.staged && file.unstaged));
    fs::remove_dir_all(repo).ok();
}

#[test]
fn mark_conflicts_resolved_stages_resolved_conflict_file() {
    let repo = create_conflict_repo();
    fs::write(repo.join("tracked.txt"), "resolved\n").expect("resolve conflict");
    let before = git_status(&repo);

    let response = mark_conflicts_resolved(request(&repo, ["tracked.txt"])).expect("mark resolved");

    let after = git_status(&repo);
    write_evidence("mark conflict resolved", &before, &after);
    assert!(after.starts_with("M  tracked.txt"));
    assert!(response
        .files
        .iter()
        .all(|file| file.path != "tracked.txt" || !file.conflict));
    fs::remove_dir_all(repo).ok();
}

#[test]
fn mark_conflicts_resolved_rejects_non_conflict_file() {
    let repo = create_repo_with_tracked_file();
    fs::write(repo.join("tracked.txt"), "modified\n").expect("modify tracked");

    let error = match mark_conflicts_resolved(request(&repo, ["tracked.txt"])) {
        Ok(_) => panic!("non-conflict path should be rejected"),
        Err(error) => error,
    };

    assert!(error.contains("not conflicted"));
    fs::remove_dir_all(repo).ok();
}

#[test]
fn apply_file_change_stages_only_selected_worktree_hunk() {
    let repo = create_repo_with_multiline_file();
    fs::write(repo.join("tracked.txt"), "one\nTWO\nthree\nfour\nFIVE\n").expect("modify tracked");

    apply_file_change(change_request(
        &repo,
        GitChangeSource::Worktree,
        GitChangeOperation::Stage,
        2,
        1,
        2,
        1,
    ))
    .expect("stage one hunk");

    let cached = run_git(&repo, &["diff", "--cached", "--", "tracked.txt"]);
    let worktree = run_git(&repo, &["diff", "--", "tracked.txt"]);
    assert!(cached.contains("TWO"));
    assert!(!cached.contains("FIVE"));
    assert!(worktree.contains("FIVE"));
    assert!(!worktree.contains("+TWO"));
    fs::remove_dir_all(repo).ok();
}

#[test]
fn apply_file_change_unstages_only_selected_staged_hunk() {
    let repo = create_repo_with_multiline_file();
    fs::write(repo.join("tracked.txt"), "one\nTWO\nthree\nfour\nFIVE\n").expect("modify tracked");
    run_git(&repo, &["add", "tracked.txt"]);

    apply_file_change(change_request(
        &repo,
        GitChangeSource::Staged,
        GitChangeOperation::Unstage,
        5,
        1,
        5,
        1,
    ))
    .expect("unstage one hunk");

    let cached = run_git(&repo, &["diff", "--cached", "--", "tracked.txt"]);
    let worktree = run_git(&repo, &["diff", "--", "tracked.txt"]);
    assert!(cached.contains("TWO"));
    assert!(!cached.contains("FIVE"));
    assert!(worktree.contains("FIVE"));
    assert!(!worktree.contains("+TWO"));
    fs::remove_dir_all(repo).ok();
}

#[test]
fn apply_file_change_discards_only_selected_worktree_hunk() {
    let repo = create_repo_with_multiline_file();
    fs::write(repo.join("tracked.txt"), "one\nTWO\nthree\nfour\nFIVE\n").expect("modify tracked");

    apply_file_change(change_request(
        &repo,
        GitChangeSource::Worktree,
        GitChangeOperation::Discard,
        2,
        1,
        2,
        1,
    ))
    .expect("discard one hunk");

    let content = fs::read_to_string(repo.join("tracked.txt")).expect("read tracked");
    assert_eq!(content, "one\ntwo\nthree\nfour\nFIVE\n");
    let worktree = run_git(&repo, &["diff", "--", "tracked.txt"]);
    assert!(!worktree.contains("TWO"));
    assert!(worktree.contains("FIVE"));
    fs::remove_dir_all(repo).ok();
}

#[test]
fn stage_files_rejects_path_escaping_repo() {
    let repo = create_repo_with_tracked_file();

    let error = match stage_files(request(&repo, ["../escape"])) {
        Ok(_) => panic!("escape path should be rejected"),
        Err(error) => error,
    };

    assert!(error.contains("..") || error.contains("outside"));
    fs::remove_dir_all(repo).ok();
}

#[test]
fn stage_files_rejects_empty_path_list() {
    let repo = create_repo_with_tracked_file();

    let error = match stage_files(GitPathsRequest {
        path: repo.to_string_lossy().to_string(),
        paths: Vec::new(),
    }) {
        Ok(_) => panic!("empty path list should be rejected"),
        Err(error) => error,
    };

    assert!(error.contains("At least one"));
    fs::remove_dir_all(repo).ok();
}

#[test]
fn stage_files_rejects_conflict_path() {
    let repo = create_conflict_repo();

    let error = match stage_files(request(&repo, ["tracked.txt"])) {
        Ok(_) => panic!("conflict path should be rejected"),
        Err(error) => error,
    };

    assert!(error.contains("conflict"));
    fs::remove_dir_all(repo).ok();
}

#[test]
fn unstage_files_rejects_empty_path_list() {
    let repo = create_repo_with_tracked_file();

    let error = match unstage_files(GitPathsRequest {
        path: repo.to_string_lossy().to_string(),
        paths: Vec::new(),
    }) {
        Ok(_) => panic!("empty path list should be rejected"),
        Err(error) => error,
    };

    assert!(error.contains("At least one"));
    fs::remove_dir_all(repo).ok();
}

#[test]
fn evidence_writes_require_explicit_env_flag() {
    assert!(!test_evidence::write_test_evidence_enabled_with(|_| None));
    assert!(!test_evidence::write_test_evidence_enabled_with(|_| {
        Some("0".to_string())
    }));
    assert!(!test_evidence::write_test_evidence_enabled_with(|_| {
        Some("true".to_string())
    }));
    assert!(test_evidence::write_test_evidence_enabled_with(|_| {
        Some("1".to_string())
    }));
}

fn request<const N: usize>(repo: &Path, paths: [&str; N]) -> GitPathsRequest {
    GitPathsRequest {
        path: repo.to_string_lossy().to_string(),
        paths: paths.into_iter().map(str::to_string).collect(),
    }
}

fn create_repo_with_tracked_file() -> PathBuf {
    let repo = unique_temp_repo_path();
    fs::create_dir_all(&repo).expect("create temp repo");
    run_git(&repo, &["init", "--initial-branch=main"]);
    run_git(&repo, &["config", "user.email", "view@example.test"]);
    run_git(&repo, &["config", "user.name", "View Test"]);
    fs::write(repo.join("tracked.txt"), "base\n").expect("write tracked");
    run_git(&repo, &["add", "tracked.txt"]);
    run_git(&repo, &["commit", "-m", "base"]);
    repo
}

fn create_repo_with_multiline_file() -> PathBuf {
    let repo = unique_temp_repo_path();
    fs::create_dir_all(&repo).expect("create temp repo");
    run_git(&repo, &["init", "--initial-branch=main"]);
    run_git(&repo, &["config", "user.email", "view@example.test"]);
    run_git(&repo, &["config", "user.name", "View Test"]);
    fs::write(repo.join("tracked.txt"), "one\ntwo\nthree\nfour\nfive\n").expect("write tracked");
    run_git(&repo, &["add", "tracked.txt"]);
    run_git(&repo, &["commit", "-m", "base"]);
    repo
}

fn change_request(
    repo: &Path,
    source: GitChangeSource,
    operation: GitChangeOperation,
    old_start: usize,
    old_line_count: usize,
    new_start: usize,
    new_line_count: usize,
) -> GitFileChangeRequest {
    GitFileChangeRequest {
        path: repo.to_string_lossy().to_string(),
        file_path: "tracked.txt".to_string(),
        source,
        operation,
        old_start,
        old_line_count,
        new_start,
        new_line_count,
    }
}

fn create_conflict_repo() -> PathBuf {
    let repo = create_repo_with_tracked_file();
    run_git(&repo, &["checkout", "-b", "other"]);
    fs::write(repo.join("tracked.txt"), "other\n").expect("write other");
    run_git(&repo, &["commit", "-am", "other"]);
    run_git(&repo, &["checkout", "main"]);
    fs::write(repo.join("tracked.txt"), "main\n").expect("write main");
    run_git(&repo, &["commit", "-am", "main"]);
    let output = Command::new("git")
        .arg("-C")
        .arg(&repo)
        .arg("merge")
        .arg("other")
        .output()
        .expect("run conflicting merge");
    assert!(!output.status.success());
    repo
}

fn unique_temp_repo_path() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    env::temp_dir().join(format!(
        "view-git-write-test-{}-{nanos}",
        std::process::id()
    ))
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

fn write_evidence(case_name: &str, before: &str, after: &str) {
    let record = format!("case: {case_name}\nbefore:\n{before}\nafter:\n{after}\n\n");
    test_evidence::write_test_evidence(
        ".omo/evidence/task-4-git-write-actions.txt",
        record.as_bytes(),
    );
}
