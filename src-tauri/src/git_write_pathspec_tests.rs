use super::{
    stage_files as async_stage_files, unstage_files as async_unstage_files, GitPathsRequest,
    GitWriteResponse,
};
use crate::git_restore::{restore_files as async_restore_files, RestoreFilesRequest, RestoreMode};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn stage_files(request: GitPathsRequest) -> Result<GitWriteResponse, String> {
    tauri::async_runtime::block_on(async_stage_files(request))
}

fn unstage_files(request: GitPathsRequest) -> Result<GitWriteResponse, String> {
    tauri::async_runtime::block_on(async_unstage_files(request))
}

fn restore_files(request: RestoreFilesRequest) -> Result<GitWriteResponse, String> {
    tauri::async_runtime::block_on(async_restore_files(request))
}

#[test]
fn stage_files_treats_glob_pathspec_as_literal_when_staging() {
    // Given: an untracked file is named like a glob and another file matches that glob.
    let repo = create_repo_with_base("stage-glob-literal");
    fs::write(repo.path().join("*.txt"), "literal glob\n").expect("write literal glob file");
    fs::write(repo.path().join("other.txt"), "other\n").expect("write other file");

    // When: stage_files receives the glob-looking filename.
    let response = stage_files(paths_request(repo.path(), ["*.txt"])).expect("stage literal glob");

    // Then: only the literal filename is staged.
    let status = git_status(repo.path());
    assert_status_contains(&status, "A  *.txt");
    assert_status_contains(&status, "?? other.txt");
    assert!(response
        .files
        .iter()
        .any(|file| file.path == "*.txt" && file.staged && !file.untracked));
}

#[test]
fn unstage_files_treats_glob_pathspec_as_literal_when_unstaging() {
    // Given: a glob-looking filename and a matching filename are both staged.
    let repo = create_repo_with_base("unstage-glob-literal");
    fs::write(repo.path().join("*.txt"), "literal glob\n").expect("write literal glob file");
    fs::write(repo.path().join("other.txt"), "other\n").expect("write other file");
    git_add_literal(repo.path(), &["*.txt", "other.txt"]);

    // When: unstage_files receives the glob-looking filename.
    let response =
        unstage_files(paths_request(repo.path(), ["*.txt"])).expect("unstage literal glob");

    // Then: only the literal filename is unstaged.
    let status = git_status(repo.path());
    assert_status_contains(&status, "?? *.txt");
    assert_status_contains(&status, "A  other.txt");
    assert!(response
        .files
        .iter()
        .any(|file| file.path == "other.txt" && file.staged));
}

#[test]
fn restore_files_treats_glob_pathspec_as_literal_when_restoring_tracked_file() {
    // Given: a tracked file is named like a glob and another tracked file matches that glob.
    let repo = create_repo_with_tracked_files("restore-glob-literal", &["*.txt", "other.txt"]);
    fs::write(repo.path().join("*.txt"), "changed literal glob\n")
        .expect("modify literal glob file");
    fs::write(repo.path().join("other.txt"), "changed other\n").expect("modify other file");

    // When: restore_files receives the glob-looking filename.
    let response = restore_files(restore_request(
        repo.path(),
        ["*.txt"],
        RestoreMode::Worktree,
    ))
    .expect("restore literal glob");

    // Then: only the literal filename is restored.
    let status = git_status(repo.path());
    assert_eq!(
        fs::read_to_string(repo.path().join("*.txt")).expect("read literal glob"),
        "base *.txt\n"
    );
    assert_eq!(
        fs::read_to_string(repo.path().join("other.txt")).expect("read other"),
        "changed other\n"
    );
    assert_status_excludes(&status, "*.txt");
    assert_status_contains(&status, " M other.txt");
    assert!(response
        .files
        .iter()
        .any(|file| file.path == "other.txt" && file.unstaged));
}

#[cfg(unix)]
#[test]
fn stage_files_treats_top_magic_pathspec_as_literal_filename() {
    // Given: Unix permits ':' in filenames, including strings that look like Git magic.
    let repo = create_repo_with_base("stage-top-magic-literal");
    fs::write(repo.path().join(":(top)literal.txt"), "literal magic\n")
        .expect("write magic-looking file");
    fs::write(repo.path().join("literal.txt"), "top literal\n").expect("write top literal file");

    // When: stage_files receives the magic-looking filename.
    let response = stage_files(paths_request(repo.path(), [":(top)literal.txt"]))
        .expect("stage magic-looking filename");

    // Then: Git treats the argument as a filename, not pathspec magic.
    let status = git_status(repo.path());
    assert_status_contains(&status, "A  :(top)literal.txt");
    assert_status_contains(&status, "?? literal.txt");
    assert!(response
        .files
        .iter()
        .any(|file| file.path == ":(top)literal.txt" && file.staged && !file.untracked));
}

#[cfg(unix)]
#[test]
fn unstage_files_treats_top_magic_pathspec_as_literal_filename() {
    // Given: a staged file is named like Git top magic and the top target is also staged.
    let repo = create_repo_with_base("unstage-top-magic-literal");
    fs::write(repo.path().join(":(top)literal.txt"), "literal magic\n")
        .expect("write magic-looking file");
    fs::write(repo.path().join("literal.txt"), "top literal\n").expect("write top literal file");
    git_add_literal(repo.path(), &[":(top)literal.txt", "literal.txt"]);

    // When: unstage_files receives the magic-looking filename.
    unstage_files(paths_request(repo.path(), [":(top)literal.txt"]))
        .expect("unstage magic-looking filename");

    // Then: only the magic-looking filename is unstaged.
    let status = git_status(repo.path());
    assert_status_contains(&status, "?? :(top)literal.txt");
    assert_status_contains(&status, "A  literal.txt");
}

#[cfg(unix)]
#[test]
fn restore_files_treats_top_magic_pathspec_as_literal_filename() {
    // Given: a tracked file is named like Git top magic and the top target is also modified.
    let repo = create_repo_with_tracked_files(
        "restore-top-magic-literal",
        &[":(top)literal.txt", "literal.txt"],
    );
    fs::write(
        repo.path().join(":(top)literal.txt"),
        "changed literal magic\n",
    )
    .expect("modify magic-looking file");
    fs::write(repo.path().join("literal.txt"), "changed top literal\n")
        .expect("modify top literal file");

    // When: restore_files receives the magic-looking filename.
    restore_files(restore_request(
        repo.path(),
        [":(top)literal.txt"],
        RestoreMode::Worktree,
    ))
    .expect("restore magic-looking filename");

    // Then: only the magic-looking filename is restored.
    let status = git_status(repo.path());
    assert_eq!(
        fs::read_to_string(repo.path().join(":(top)literal.txt")).expect("read magic-looking file"),
        "base :(top)literal.txt\n"
    );
    assert_eq!(
        fs::read_to_string(repo.path().join("literal.txt")).expect("read top literal file"),
        "changed top literal\n"
    );
    assert_status_excludes(&status, ":(top)literal.txt");
    assert_status_contains(&status, " M literal.txt");
}

fn assert_status_contains(status: &str, line: &str) {
    assert!(
        status.contains(line),
        "status should contain {line}:\n{status}"
    );
}

fn assert_status_excludes(status: &str, line: &str) {
    assert!(
        !status.contains(line),
        "status should not contain {line}:\n{status}"
    );
}

fn paths_request<const N: usize>(repo: &Path, paths: [&str; N]) -> GitPathsRequest {
    GitPathsRequest {
        path: repo.to_string_lossy().to_string(),
        paths: paths.into_iter().map(str::to_string).collect(),
    }
}

fn restore_request<const N: usize>(
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

fn create_repo_with_base(prefix: &str) -> TempRepo {
    let repo = TempRepo::new(prefix);
    fs::create_dir_all(repo.path()).expect("create temp repo");
    run_git(repo.path(), &["init", "--initial-branch=main"]);
    run_git(repo.path(), &["config", "user.email", "view@example.test"]);
    run_git(repo.path(), &["config", "user.name", "View Test"]);
    fs::write(repo.path().join("base.txt"), "base\n").expect("write base");
    git_add_literal(repo.path(), &["base.txt"]);
    run_git(repo.path(), &["commit", "-m", "base"]);
    repo
}

fn create_repo_with_tracked_files(prefix: &str, paths: &[&str]) -> TempRepo {
    let repo = create_repo_with_base(prefix);
    for path in paths {
        fs::write(repo.path().join(path), format!("base {path}\n")).expect("write tracked file");
    }
    git_add_literal(repo.path(), paths);
    run_git(repo.path(), &["commit", "-m", "tracked files"]);
    repo
}

fn git_add_literal(repo: &Path, paths: &[&str]) {
    let mut args = vec!["add".to_string(), "--".to_string()];
    args.extend(paths.iter().map(|path| format!(":(literal){path}")));
    run_git_owned(repo, &args);
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

fn run_git_owned(repo: &Path, args: &[String]) -> String {
    let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    run_git(repo, &arg_refs)
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

struct TempRepo {
    path: PathBuf,
}

impl TempRepo {
    fn new(prefix: &str) -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let path = env::temp_dir().join(format!(
            "view-git-write-pathspec-{prefix}-{}-{nanos}",
            std::process::id()
        ));
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempRepo {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.path).ok();
    }
}
