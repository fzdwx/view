use super::{
    add_remote as async_add_remote, delete_remote_branch as async_delete_remote_branch,
    list_remotes as async_list_remotes, remove_remote as async_remove_remote,
    rename_remote as async_rename_remote, set_branch_upstream as async_set_branch_upstream,
    AddRemoteRequest, DeleteRemoteBranchRequest, ListRemotesResponse, RemoteWriteRequest,
    RenameRemoteRequest, SetBranchUpstreamRequest,
};
use crate::git_write::GitWriteResponse;

#[path = "git_commit_push_test_support.rs"]
mod support;

use support::{create_clone_with_local_bare_remote, run_git, run_git_dir};

fn list_remotes(path: String) -> Result<ListRemotesResponse, String> {
    tauri::async_runtime::block_on(async_list_remotes(path))
}

fn add_remote(request: AddRemoteRequest) -> Result<GitWriteResponse, String> {
    tauri::async_runtime::block_on(async_add_remote(request))
}

fn rename_remote(request: RenameRemoteRequest) -> Result<GitWriteResponse, String> {
    tauri::async_runtime::block_on(async_rename_remote(request))
}

fn remove_remote(request: RemoteWriteRequest) -> Result<GitWriteResponse, String> {
    tauri::async_runtime::block_on(async_remove_remote(request))
}

fn set_branch_upstream(request: SetBranchUpstreamRequest) -> Result<GitWriteResponse, String> {
    tauri::async_runtime::block_on(async_set_branch_upstream(request))
}

fn delete_remote_branch(request: DeleteRemoteBranchRequest) -> Result<GitWriteResponse, String> {
    tauri::async_runtime::block_on(async_delete_remote_branch(request))
}

#[test]
fn remote_list_add_rename_remove_roundtrip() {
    let (_seed, remote, clone) = create_clone_with_local_bare_remote();

    let initial = list_remotes(clone.path_string()).expect("list remotes");
    assert!(initial.remotes.iter().any(|remote| remote.name == "origin"));

    add_remote(AddRemoteRequest {
        path: clone.path_string(),
        name: "backup".to_string(),
        url: remote.path_string(),
    })
    .expect("add remote");
    rename_remote(RenameRemoteRequest {
        path: clone.path_string(),
        name: "backup".to_string(),
        new_name: "mirror".to_string(),
    })
    .expect("rename remote");
    let renamed = list_remotes(clone.path_string()).expect("list renamed remotes");
    assert!(renamed.remotes.iter().any(|remote| remote.name == "mirror"));

    remove_remote(RemoteWriteRequest {
        path: clone.path_string(),
        name: "mirror".to_string(),
    })
    .expect("remove remote");
    let removed = list_remotes(clone.path_string()).expect("list removed remotes");
    assert!(!removed.remotes.iter().any(|remote| remote.name == "mirror"));
}

#[test]
fn set_branch_upstream_configures_tracking_ref() {
    let (_seed, _remote, clone) = create_clone_with_local_bare_remote();
    run_git(clone.path(), &["config", "--unset", "branch.main.remote"]);
    run_git(clone.path(), &["config", "--unset", "branch.main.merge"]);

    set_branch_upstream(SetBranchUpstreamRequest {
        path: clone.path_string(),
        branch: "main".to_string(),
        upstream: "origin/main".to_string(),
    })
    .expect("set upstream");

    assert_eq!(
        run_git(clone.path(), &["rev-parse", "--symbolic-full-name", "@{upstream}"]),
        "refs/remotes/origin/main"
    );
}

#[test]
fn delete_remote_branch_removes_remote_ref() {
    let (_seed, remote, clone) = create_clone_with_local_bare_remote();
    run_git(clone.path(), &["checkout", "-b", "feature/delete-remote"]);
    run_git(clone.path(), &["push", "-u", "origin", "feature/delete-remote"]);
    assert_eq!(
        run_git_dir(remote.path(), &["rev-parse", "refs/heads/feature/delete-remote"]),
        run_git(clone.path(), &["rev-parse", "HEAD"])
    );

    delete_remote_branch(DeleteRemoteBranchRequest {
        path: clone.path_string(),
        remote: "origin".to_string(),
        branch: "feature/delete-remote".to_string(),
    })
    .expect("delete remote branch");

    assert!(run_git_dir(remote.path(), &["branch", "--list", "feature/delete-remote"]).is_empty());
}
