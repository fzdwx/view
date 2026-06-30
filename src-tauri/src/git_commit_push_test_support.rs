#![allow(dead_code)]

use crate::git_commit_push::{CommitRequest, ResetHardToReflogRequest};
use std::env;
use std::fs;
use std::io::{ErrorKind, Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[path = "git_test_evidence.rs"]
mod test_evidence;

pub(super) fn commit_request(repo: &Path, message: &str) -> CommitRequest {
    CommitRequest {
        path: repo.to_string_lossy().to_string(),
        message: message.to_string(),
    }
}

pub(super) fn reset_hard_to_reflog_request(
    repo: &Path,
    selector: &str,
) -> ResetHardToReflogRequest {
    ResetHardToReflogRequest {
        path: repo.to_string_lossy().to_string(),
        selector: selector.to_string(),
    }
}

pub(super) fn create_repo_with_tracked_file(prefix: &str) -> TempPath {
    let repo = TempPath::new(prefix);
    fs::create_dir_all(repo.path()).expect("create temp repo");
    run_git(repo.path(), &["init", "--initial-branch=main"]);
    configure_user(repo.path());
    fs::write(repo.path().join("tracked.txt"), "base\n").expect("write tracked");
    run_git(repo.path(), &["add", "tracked.txt"]);
    run_git(repo.path(), &["commit", "-m", "base"]);
    repo
}

pub(super) fn create_repo_with_staged_file_without_identity(prefix: &str) -> TempPath {
    let repo = TempPath::new(prefix);
    fs::create_dir_all(repo.path()).expect("create temp repo");
    run_git(repo.path(), &["init", "--initial-branch=main"]);
    run_git(repo.path(), &["config", "user.name", ""]);
    run_git(repo.path(), &["config", "user.email", ""]);
    fs::write(repo.path().join("tracked.txt"), "base\n").expect("write tracked");
    run_git(repo.path(), &["add", "tracked.txt"]);
    repo
}

pub(super) fn create_clone_with_local_bare_remote() -> (TempPath, TempPath, TempPath) {
    let seed = create_repo_with_tracked_file("seed");
    let remote = TempPath::new("remote.git");
    let clone = TempPath::new("clone");
    run_git_global(&[
        "clone",
        "--bare",
        seed.path_string().as_str(),
        remote.path_string().as_str(),
    ]);
    run_git_global(&[
        "clone",
        remote.path_string().as_str(),
        clone.path_string().as_str(),
    ]);
    configure_user(clone.path());
    (seed, remote, clone)
}

pub(super) fn advance_remote(remote: &TempPath, content: &str) -> String {
    let clone = TempPath::new("remote-advance");
    run_git_global(&[
        "clone",
        remote.path_string().as_str(),
        clone.path_string().as_str(),
    ]);
    configure_user(clone.path());
    fs::write(clone.path().join("tracked.txt"), content).expect("advance remote file");
    run_git(clone.path(), &["add", "tracked.txt"]);
    run_git(clone.path(), &["commit", "-m", "advance remote"]);
    run_git(clone.path(), &["push", "origin", "main"]);
    git_head(clone.path())
}

pub(super) fn configure_user(repo: &Path) {
    run_git(repo, &["config", "user.email", "view@example.test"]);
    run_git(repo, &["config", "user.name", "View Test"]);
}

pub(super) fn install_hook(repo_or_git_dir: &Path, name: &str, body: &str) {
    let hook_dir = if repo_or_git_dir.join(".git").is_dir() {
        repo_or_git_dir.join(".git/hooks")
    } else {
        repo_or_git_dir.join("hooks")
    };
    let hook = hook_dir.join(name);
    fs::write(&hook, body).expect("write git hook");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&hook).expect("hook metadata").permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&hook, permissions).expect("mark hook executable");
    }
}

pub(super) fn git_head(repo: &Path) -> String {
    run_git(repo, &["rev-parse", "HEAD"])
}

pub(super) fn git_status(repo: &Path) -> String {
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

pub(super) fn run_git(repo: &Path, args: &[&str]) -> String {
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

pub(super) fn run_git_dir(git_dir: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .arg("--git-dir")
        .arg(git_dir)
        .args(args)
        .output()
        .unwrap_or_else(|error| panic!("failed to run git-dir {args:?}: {error}"));
    if !output.status.success() {
        panic!(
            "git-dir {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

pub(super) fn write_evidence(record: &str) {
    test_evidence::write_test_evidence(
        ".omo/evidence/task-6-git-write-actions.txt",
        record.as_bytes(),
    );
}

pub(super) fn auth_required_http_remote() -> AuthHttpRemote {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind auth HTTP remote");
    listener
        .set_nonblocking(true)
        .expect("configure auth HTTP remote");
    let address = listener
        .local_addr()
        .expect("read auth HTTP remote address");
    let (stop_tx, stop_rx) = mpsc::channel();
    let handle = thread::spawn(move || {
        let response = concat!(
            "HTTP/1.1 401 Unauthorized\r\n",
            "WWW-Authenticate: Basic realm=\"view-test\"\r\n",
            "Content-Length: 0\r\n",
            "Connection: close\r\n\r\n"
        )
        .as_bytes();
        loop {
            match listener.accept() {
                Ok((mut stream, _address)) => {
                    let mut buffer = [0_u8; 1024];
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
                    let _ = stream.read(&mut buffer);
                    let _ = stream.write_all(response);
                    break;
                }
                Err(error) if error.kind() == ErrorKind::WouldBlock => {
                    if stop_rx.try_recv().is_ok() {
                        break;
                    }
                    thread::park_timeout(Duration::from_millis(5));
                }
                Err(_) => break,
            }
        }
    });
    AuthHttpRemote {
        url: format!("http://{address}/repo.git"),
        stop: Some(stop_tx),
        handle: Some(handle),
    }
}

pub(super) struct AuthHttpRemote {
    url: String,
    stop: Option<mpsc::Sender<()>>,
    handle: Option<thread::JoinHandle<()>>,
}

impl AuthHttpRemote {
    pub(super) fn url(&self) -> &str {
        &self.url
    }
}

impl Drop for AuthHttpRemote {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

pub(super) struct TempPath {
    path: PathBuf,
}

impl TempPath {
    fn new(prefix: &str) -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let path = env::temp_dir().join(format!(
            "view-git-commit-push-{prefix}-{}-{nanos}",
            std::process::id()
        ));
        Self { path }
    }

    pub(super) fn path(&self) -> &Path {
        &self.path
    }

    pub(super) fn path_string(&self) -> String {
        self.path.to_string_lossy().to_string()
    }
}

impl Drop for TempPath {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.path).ok();
    }
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
