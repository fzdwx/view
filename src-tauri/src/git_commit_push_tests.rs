use super::{
    create_commit as async_create_commit, push_current_branch as async_push_current_branch,
    reset_hard_to_reflog as async_reset_hard_to_reflog, CommitRequest, CommitWriteResponse,
    ResetHardToReflogRequest,
};
use crate::git_write::GitWriteResponse;
use std::fs;

#[path = "git_commit_push_test_support.rs"]
mod support;

use support::{
    advance_remote, auth_required_http_remote, commit_request, create_clone_with_local_bare_remote,
    create_repo_with_staged_file_without_identity, create_repo_with_tracked_file, git_head,
    git_status, install_hook, reset_hard_to_reflog_request, run_git, run_git_dir, write_evidence,
};

fn create_commit(request: CommitRequest) -> Result<CommitWriteResponse, String> {
    tauri::async_runtime::block_on(async_create_commit(request))
}

fn push_current_branch(path: String) -> Result<GitWriteResponse, String> {
    tauri::async_runtime::block_on(async_push_current_branch(path))
}

fn reset_hard_to_reflog(request: ResetHardToReflogRequest) -> Result<GitWriteResponse, String> {
    tauri::async_runtime::block_on(async_reset_hard_to_reflog(request))
}

#[test]
fn commit_rejects_empty_message() {
    // Given: a repository has staged changes.
    let repo = create_repo_with_tracked_file("empty-message");
    fs::write(repo.path().join("tracked.txt"), "changed\n").expect("modify tracked");
    run_git(repo.path(), &["add", "tracked.txt"]);
    let before_head = git_head(repo.path());

    // When: commit receives only whitespace as its message.
    let error = match create_commit(commit_request(repo.path(), " \n\t ")) {
        Ok(_) => panic!("empty message should be rejected"),
        Err(error) => error,
    };

    // Then: no commit is created.
    assert!(error.contains("Commit message cannot be empty"));
    assert_eq!(git_head(repo.path()), before_head);
}

#[test]
fn commit_commits_staged_only_while_unstaged_changes_remain() {
    // Given: the index and worktree contain different versions of the same file.
    let repo = create_repo_with_tracked_file("staged-only");
    fs::write(repo.path().join("tracked.txt"), "staged\n").expect("write staged content");
    run_git(repo.path(), &["add", "tracked.txt"]);
    fs::write(repo.path().join("tracked.txt"), "unstaged\n").expect("write unstaged content");

    // When: create_commit commits the current index.
    let response =
        create_commit(commit_request(repo.path(), "  staged content  ")).expect("create commit");

    // Then: HEAD has the staged content and the unstaged worktree change remains.
    let head = git_head(repo.path());
    let short_head = run_git(repo.path(), &["rev-parse", "--short", "HEAD"]);
    let head_content = run_git(repo.path(), &["show", "HEAD:tracked.txt"]);
    let status = git_status(repo.path());
    write_evidence(&format!(
        "case: commit staged only\ncommit hash: {head}\nshort hash: {short_head}\nstatus after:\n{status}\n"
    ));
    assert_eq!(response.hash, head);
    assert_eq!(response.short_hash, short_head);
    assert_eq!(head_content, "staged");
    assert_eq!(
        fs::read_to_string(repo.path().join("tracked.txt")).expect("read worktree"),
        "unstaged\n"
    );
    assert!(status.starts_with(" M tracked.txt"));
    assert!(response
        .files
        .iter()
        .any(|file| file.path == "tracked.txt" && file.unstaged && !file.staged));
}

#[test]
fn commit_rejects_when_no_changes_are_staged() {
    // Given: a repository only has unstaged worktree changes.
    let repo = create_repo_with_tracked_file("no-staged");
    fs::write(repo.path().join("tracked.txt"), "unstaged\n").expect("modify tracked");
    let before_status = git_status(repo.path());

    // When: create_commit runs without index changes.
    let error = match create_commit(commit_request(repo.path(), "message")) {
        Ok(_) => panic!("commit without staged changes should be rejected"),
        Err(error) => error,
    };

    // Then: the unstaged change remains untouched.
    assert!(error.contains("No staged changes to commit"));
    assert_eq!(git_status(repo.path()), before_status);
}

#[test]
fn commit_rejects_missing_identity() {
    // Given: a repository has staged changes but local identity is explicitly blank.
    let repo = create_repo_with_staged_file_without_identity("missing-identity");

    // When: create_commit asks Git to create the commit.
    let error = match create_commit(commit_request(repo.path(), "needs identity")) {
        Ok(_) => panic!("commit without identity should be rejected"),
        Err(error) => error,
    };

    // Then: the user gets a clear identity error and the staged file remains.
    write_evidence(&format!("case: commit missing identity\nerror: {error}\n"));
    assert!(error.contains("Git identity is not configured"));
    assert!(git_status(repo.path()).starts_with("A  tracked.txt"));
}

#[test]
fn commit_reports_commit_msg_hook_rejection() {
    // Given: a commit-msg hook rejects the commit.
    let repo = create_repo_with_tracked_file("commit-msg-hook");
    install_hook(
        repo.path(),
        "commit-msg",
        "#!/bin/sh\necho blocked by commit-msg hook >&2\nexit 1\n",
    );
    fs::write(repo.path().join("tracked.txt"), "blocked\n").expect("modify tracked");
    run_git(repo.path(), &["add", "tracked.txt"]);
    let before_head = git_head(repo.path());

    // When: create_commit runs.
    let error = match create_commit(commit_request(repo.path(), "blocked")) {
        Ok(_) => panic!("commit hook rejection should be returned"),
        Err(error) => error,
    };

    // Then: the hook rejection is reported without moving HEAD.
    write_evidence(&format!(
        "case: commit-msg hook rejection\nerror: {error}\n"
    ));
    assert!(error.contains("Commit was rejected by a Git hook"));
    assert!(error.contains("blocked by commit-msg hook"));
    assert_eq!(git_head(repo.path()), before_head);
}

#[test]
fn commit_rejects_nul_message_before_git_commit() {
    // Given: a repository has staged changes and a hook that would leave a marker.
    let repo = create_repo_with_tracked_file("nul-message");
    install_hook(
        repo.path(),
        "commit-msg",
        "#!/bin/sh\nprintf hook-ran > hook-ran\nexit 1\n",
    );
    fs::write(repo.path().join("tracked.txt"), "nul\n").expect("modify tracked");
    run_git(repo.path(), &["add", "tracked.txt"]);
    let before_head = git_head(repo.path());

    // When: the message contains a NUL byte.
    let error = match create_commit(commit_request(repo.path(), "bad\0message")) {
        Ok(_) => panic!("NUL commit message should be rejected"),
        Err(error) => error,
    };

    // Then: the message is rejected before Git can run commit hooks.
    write_evidence(&format!(
        "case: commit NUL message rejection\nerror: {error}\n"
    ));
    assert!(error.contains("NUL"));
    assert_eq!(git_head(repo.path()), before_head);
    assert!(!repo.path().join("hook-ran").exists());
}

#[test]
fn reset_hard_to_reflog_moves_head_and_discards_tracked_changes() {
    // Given: the repository has multiple reflog entries plus staged and unstaged changes.
    let repo = create_repo_with_tracked_file("reset-reflog");
    fs::write(repo.path().join("tracked.txt"), "first\n").expect("write first");
    run_git(repo.path(), &["add", "tracked.txt"]);
    let target_commit = create_commit(commit_request(repo.path(), "first")).expect("commit first");

    fs::write(repo.path().join("tracked.txt"), "second\n").expect("write second");
    run_git(repo.path(), &["add", "tracked.txt"]);
    create_commit(commit_request(repo.path(), "second")).expect("commit second");

    fs::write(repo.path().join("tracked.txt"), "staged dirty\n").expect("write staged dirty");
    run_git(repo.path(), &["add", "tracked.txt"]);
    fs::write(repo.path().join("tracked.txt"), "unstaged dirty\n").expect("write unstaged dirty");

    // When: resetting hard to the previous reflog position.
    let response = reset_hard_to_reflog(reset_hard_to_reflog_request(repo.path(), "HEAD@{1}"))
        .expect("reset to reflog");

    // Then: HEAD moves back and tracked changes are discarded.
    let reflog_action = run_git(repo.path(), &["reflog", "-1", "--pretty=%gs"]);
    assert_eq!(git_head(repo.path()), target_commit.hash);
    assert_eq!(
        fs::read_to_string(repo.path().join("tracked.txt")).expect("read tracked"),
        "first\n"
    );
    assert!(git_status(repo.path()).trim().is_empty());
    assert!(reflog_action.contains("reset: moving to HEAD@{1}"));
    assert_eq!(response.summary.head, target_commit.short_hash);
    assert!(response.files.is_empty());
}

#[test]
fn reset_hard_to_reflog_rejects_non_numeric_selector() {
    // Given: a valid repository.
    let repo = create_repo_with_tracked_file("reset-invalid-selector");

    // When: reset_hard_to_reflog receives a non-numeric selector.
    let error = match reset_hard_to_reflog(reset_hard_to_reflog_request(
        repo.path(),
        "HEAD@{yesterday}",
    )) {
        Ok(_) => panic!("non-numeric selector should be rejected"),
        Err(error) => error,
    };

    // Then: the command is rejected before invoking git reset.
    assert!(error.contains("Only numeric HEAD reflog selectors are supported"));
}

#[test]
fn push_rejects_detached_head() {
    // Given: HEAD is detached.
    let repo = create_repo_with_tracked_file("detached-push");
    run_git(repo.path(), &["checkout", "--detach", "HEAD"]);

    // When: push_current_branch runs.
    let error = match push_current_branch(repo.path_string()) {
        Ok(_) => panic!("detached HEAD should be rejected"),
        Err(error) => error,
    };

    // Then: the user gets a branch-specific error.
    assert!(error.contains("detached"));
}

#[test]
fn push_rejects_missing_upstream() {
    // Given: the current branch has no configured upstream.
    let repo = create_repo_with_tracked_file("missing-upstream");

    // When: push_current_branch runs.
    let error = match push_current_branch(repo.path_string()) {
        Ok(_) => panic!("missing upstream should be rejected"),
        Err(error) => error,
    };

    // Then: no set-upstream flow is attempted.
    assert!(error.contains("upstream"));
}

#[test]
fn push_rejects_when_branch_has_no_local_commits() {
    // Given: the current branch matches its configured upstream.
    let (_seed, _remote, clone) = create_clone_with_local_bare_remote();

    // When: push_current_branch runs.
    let error = match push_current_branch(clone.path_string()) {
        Ok(_) => panic!("up-to-date branch should be rejected"),
        Err(error) => error,
    };

    // Then: the user is told there are no local commits to push.
    write_evidence(&format!("case: push no ahead commits\nerror: {error}\n"));
    assert!(error.contains("no local commits to push"));
}

#[test]
fn push_rejects_behind_only_branch() {
    // Given: the upstream branch has advanced and the local branch has no local commits.
    let (_seed, remote, clone) = create_clone_with_local_bare_remote();
    let remote_head = advance_remote(&remote, "remote advanced\n");
    run_git(clone.path(), &["fetch", "origin"]);

    // When: push_current_branch runs.
    let error = match push_current_branch(clone.path_string()) {
        Ok(_) => panic!("behind-only branch should be rejected"),
        Err(error) => error,
    };

    // Then: the user is told to integrate upstream first.
    write_evidence(&format!(
        "case: push behind-only branch\nremote refs/heads/main: {remote_head}\nerror: {error}\n"
    ));
    assert!(error.contains("behind its upstream"));
}

#[test]
fn push_rejects_diverged_branch() {
    // Given: the local and upstream branches each have unique commits.
    let (_seed, remote, clone) = create_clone_with_local_bare_remote();
    fs::write(clone.path().join("tracked.txt"), "local advanced\n").expect("modify tracked");
    run_git(clone.path(), &["add", "tracked.txt"]);
    let local = create_commit(commit_request(clone.path(), "local advance")).expect("commit");
    let remote_head = advance_remote(&remote, "remote advanced\n");
    run_git(clone.path(), &["fetch", "origin"]);

    // When: push_current_branch runs.
    let error = match push_current_branch(clone.path_string()) {
        Ok(_) => panic!("diverged branch should be rejected"),
        Err(error) => error,
    };

    // Then: the user is told the branch diverged.
    write_evidence(&format!(
        "case: push diverged branch\nlocal HEAD: {}\nremote refs/heads/main: {remote_head}\nerror: {error}\n",
        local.hash
    ));
    assert!(error.contains("diverged from its upstream"));
}

#[test]
fn push_pushes_current_branch_to_local_bare_remote() {
    // Given: a clone is one commit ahead of its configured local bare upstream.
    let (_seed, remote, clone) = create_clone_with_local_bare_remote();
    fs::write(clone.path().join("tracked.txt"), "pushed\n").expect("modify tracked");
    run_git(clone.path(), &["add", "tracked.txt"]);
    let commit = create_commit(commit_request(clone.path(), "push me")).expect("commit");

    // When: push_current_branch pushes the current branch.
    let response = push_current_branch(clone.path_string()).expect("push branch");

    // Then: the configured remote ref points at the new commit.
    let remote_head = run_git_dir(remote.path(), &["rev-parse", "refs/heads/main"]);
    write_evidence(&format!(
        "case: push local bare remote\ncommit hash: {}\nremote refs/heads/main: {remote_head}\nsummary branch: {}\n",
        commit.hash, response.summary.branch
    ));
    assert_eq!(remote_head, commit.hash);
    let current = response
        .summary
        .branches
        .iter()
        .find(|branch| branch.current)
        .expect("current branch");
    assert_eq!(current.ahead, Some(0));
    assert_eq!(current.behind, Some(0));
}

#[test]
fn push_reports_remote_hook_rejection() {
    // Given: the configured bare remote rejects updates in pre-receive.
    let (_seed, remote, clone) = create_clone_with_local_bare_remote();
    install_hook(
        remote.path(),
        "pre-receive",
        "#!/bin/sh\necho blocked by pre-receive hook >&2\nexit 1\n",
    );
    fs::write(clone.path().join("tracked.txt"), "blocked push\n").expect("modify tracked");
    run_git(clone.path(), &["add", "tracked.txt"]);
    let commit = create_commit(commit_request(clone.path(), "blocked push")).expect("commit");

    // When: push_current_branch runs.
    let error = match push_current_branch(clone.path_string()) {
        Ok(_) => panic!("push hook rejection should be returned"),
        Err(error) => error,
    };

    // Then: the hook rejection is reported and the remote ref is unchanged.
    let remote_head = run_git_dir(remote.path(), &["rev-parse", "refs/heads/main"]);
    write_evidence(&format!(
        "case: push pre-receive hook rejection\ncommit hash: {}\nremote refs/heads/main: {remote_head}\nerror: {error}\n",
        commit.hash
    ));
    assert!(error.contains("Push was rejected by a Git hook"));
    assert_ne!(remote_head, commit.hash);
}

#[test]
fn push_reports_auth_prompt_failure_noninteractively() {
    // Given: a local HTTP remote requires credentials and the branch has a commit to push.
    let (_seed, _remote, clone) = create_clone_with_local_bare_remote();
    fs::write(clone.path().join("tracked.txt"), "auth prompt\n").expect("modify tracked");
    run_git(clone.path(), &["add", "tracked.txt"]);
    create_commit(commit_request(clone.path(), "auth prompt")).expect("commit");
    let auth_remote = auth_required_http_remote();
    run_git(
        clone.path(),
        &["remote", "set-url", "origin", auth_remote.url()],
    );

    // When: push_current_branch reaches the credential prompt path.
    let error = match push_current_branch(clone.path_string()) {
        Ok(_) => panic!("credential prompt should be rejected"),
        Err(error) => error,
    };

    // Then: Git fails quickly with terminal prompts disabled instead of waiting for input.
    write_evidence(&format!(
        "case: push noninteractive credential rejection\nerror: {error}\n"
    ));
    let lower = error.to_ascii_lowercase();
    assert!(error.contains("Push authentication failed"));
    assert!(
        lower.contains("terminal prompts disabled")
            || lower.contains("could not read username")
            || lower.contains("could not read password")
            || lower.contains("askpass")
    );
}
