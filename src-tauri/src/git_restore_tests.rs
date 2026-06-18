use super::{restore_files, RestoreFilesRequest, RestoreMode};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[path = "git_test_evidence.rs"]
mod test_evidence;

#[test]
fn restore_files_restores_modified_tracked_file() {
    // Given: a tracked file has unstaged worktree changes.
    let repo = create_repo_with_files();
    fs::write(repo.join("tracked.txt"), "changed\n").expect("modify tracked");
    let before_status = git_status(&repo);
    let before_fs = filesystem_snapshot(&repo, ["tracked.txt"]);

    // When: the worktree restore command targets that file.
    let response =
        restore_files(request(&repo, ["tracked.txt"], RestoreMode::Worktree)).expect("restore");

    // Then: the tracked file returns to HEAD and refreshed status omits it.
    let after_status = git_status(&repo);
    let after_fs = filesystem_snapshot(&repo, ["tracked.txt"]);
    write_restore_evidence(
        "restore modified tracked",
        &before_status,
        &after_status,
        &before_fs,
        &after_fs,
    );
    assert_eq!(
        fs::read_to_string(repo.join("tracked.txt")).expect("read tracked"),
        "base\n"
    );
    assert!(!after_status.contains("tracked.txt"));
    assert!(!response.files.iter().any(|file| file.path == "tracked.txt"));
    fs::remove_dir_all(repo).ok();
}

#[test]
fn restore_files_discards_untracked_file() {
    // Given: an untracked file exists inside the repository.
    let repo = create_repo_with_files();
    fs::write(repo.join("new.txt"), "new\n").expect("write untracked");
    let before_status = git_status(&repo);
    let before_fs = filesystem_snapshot(&repo, ["new.txt"]);

    // When: the worktree restore command targets the untracked file.
    let response =
        restore_files(request(&repo, ["new.txt"], RestoreMode::Worktree)).expect("discard");

    // Then: the file is removed and refreshed status omits it.
    let after_status = git_status(&repo);
    let after_fs = filesystem_snapshot(&repo, ["new.txt"]);
    write_restore_evidence(
        "discard untracked",
        &before_status,
        &after_status,
        &before_fs,
        &after_fs,
    );
    assert!(!repo.join("new.txt").exists());
    assert!(!after_status.contains("new.txt"));
    assert!(!response.files.iter().any(|file| file.path == "new.txt"));
    fs::remove_dir_all(repo).ok();
}

#[test]
fn restore_files_rejects_path_escaping_repo() {
    // Given: a caller supplies a parent-directory path.
    let repo = create_repo_with_files();
    let before_status = git_status(&repo);
    let before_fs = filesystem_snapshot(&repo, ["tracked.txt"]);

    // When: restore receives the escaping path.
    let error = match restore_files(request(&repo, ["../escape"], RestoreMode::Worktree)) {
        Ok(_) => panic!("escape path should be rejected"),
        Err(error) => error,
    };

    // Then: the request fails before touching repository files.
    let after_status = git_status(&repo);
    let after_fs = filesystem_snapshot(&repo, ["tracked.txt"]);
    write_restore_evidence(
        "reject escaping path",
        &before_status,
        &after_status,
        &before_fs,
        &after_fs,
    );
    assert!(error.contains("..") || error.contains("outside"));
    assert_eq!(before_status, after_status);
    assert_eq!(before_fs, after_fs);
    fs::remove_dir_all(repo).ok();
}

#[test]
fn restore_files_rejects_conflict_path() {
    // Given: a merge conflict exists for a tracked path.
    let repo = create_conflict_repo();
    let before_status = git_status(&repo);
    let before_fs = filesystem_snapshot(&repo, ["tracked.txt"]);

    // When: restore targets the conflicted path.
    let error = match restore_files(request(&repo, ["tracked.txt"], RestoreMode::Worktree)) {
        Ok(_) => panic!("conflict path should be rejected"),
        Err(error) => error,
    };

    // Then: the conflict remains for the conflict editor flow.
    let after_status = git_status(&repo);
    let after_fs = filesystem_snapshot(&repo, ["tracked.txt"]);
    write_restore_evidence(
        "reject conflict path",
        &before_status,
        &after_status,
        &before_fs,
        &after_fs,
    );
    assert!(error.contains("conflict"));
    assert_eq!(before_status, after_status);
    assert_eq!(before_fs, after_fs);
    fs::remove_dir_all(repo).ok();
}

#[test]
fn restore_files_preserves_unrelated_file() {
    // Given: two tracked files have unstaged worktree changes.
    let repo = create_repo_with_files();
    fs::write(repo.join("tracked.txt"), "changed\n").expect("modify tracked");
    fs::write(repo.join("unrelated.txt"), "keep me\n").expect("modify unrelated");
    let before_status = git_status(&repo);
    let before_fs = filesystem_snapshot(&repo, ["tracked.txt", "unrelated.txt"]);

    // When: restore targets only one file.
    let response =
        restore_files(request(&repo, ["tracked.txt"], RestoreMode::Worktree)).expect("restore");

    // Then: the targeted file is restored while unrelated changes remain.
    let after_status = git_status(&repo);
    let after_fs = filesystem_snapshot(&repo, ["tracked.txt", "unrelated.txt"]);
    write_restore_evidence(
        "preserve unrelated file",
        &before_status,
        &after_status,
        &before_fs,
        &after_fs,
    );
    assert_eq!(
        fs::read_to_string(repo.join("tracked.txt")).expect("read tracked"),
        "base\n"
    );
    assert_eq!(
        fs::read_to_string(repo.join("unrelated.txt")).expect("read unrelated"),
        "keep me\n"
    );
    assert!(!after_status.contains("tracked.txt"));
    assert!(after_status.contains("unrelated.txt"));
    assert!(response
        .files
        .iter()
        .any(|file| file.path == "unrelated.txt"));
    fs::remove_dir_all(repo).ok();
}

fn request<const N: usize>(
    repo: &Path,
    paths: [&str; N],
    mode: RestoreMode,
) -> RestoreFilesRequest {
    RestoreFilesRequest {
        path: repo.to_string_lossy().to_string(),
        paths: paths.into_iter().map(str::to_string).collect(),
        mode,
    }
}

fn create_repo_with_files() -> PathBuf {
    let repo = unique_temp_repo_path();
    fs::create_dir_all(&repo).expect("create temp repo");
    run_git(&repo, &["init", "--initial-branch=main"]);
    run_git(&repo, &["config", "user.email", "view@example.test"]);
    run_git(&repo, &["config", "user.name", "View Test"]);
    fs::write(repo.join("tracked.txt"), "base\n").expect("write tracked");
    fs::write(repo.join("unrelated.txt"), "base unrelated\n").expect("write unrelated");
    run_git(&repo, &["add", "tracked.txt", "unrelated.txt"]);
    run_git(&repo, &["commit", "-m", "base"]);
    repo
}

fn create_conflict_repo() -> PathBuf {
    let repo = create_repo_with_files();
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
        "view-git-restore-test-{}-{nanos}",
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

fn filesystem_snapshot<const N: usize>(repo: &Path, paths: [&str; N]) -> String {
    paths
        .into_iter()
        .map(|path| match fs::read_to_string(repo.join(path)) {
            Ok(content) => format!("{path}: exists content={content:?}"),
            Err(error) => format!("{path}: missing_or_unreadable error={error}"),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn write_restore_evidence(
    case_name: &str,
    before_status: &str,
    after_status: &str,
    before_fs: &str,
    after_fs: &str,
) {
    let record = format!(
        "case: {case_name}\nbefore status:\n{before_status}before filesystem:\n{before_fs}\nafter status:\n{after_status}after filesystem:\n{after_fs}\n\n"
    );
    test_evidence::write_test_evidence(
        ".omo/evidence/task-5-git-write-actions.txt",
        record.as_bytes(),
    );
}
