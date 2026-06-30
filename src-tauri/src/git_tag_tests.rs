use super::{
    create_tag as async_create_tag, delete_tag as async_delete_tag,
    push_tag as async_push_tag, CreateTagRequest, DeleteTagRequest, PushTagRequest,
};
use crate::git_write::GitWriteResponse;

#[path = "git_commit_push_test_support.rs"]
mod support;

use support::{
    create_clone_with_local_bare_remote, create_repo_with_tracked_file, git_head, run_git,
    run_git_dir,
};

fn create_tag(request: CreateTagRequest) -> Result<GitWriteResponse, String> {
    tauri::async_runtime::block_on(async_create_tag(request))
}

fn delete_tag(request: DeleteTagRequest) -> Result<GitWriteResponse, String> {
    tauri::async_runtime::block_on(async_delete_tag(request))
}

fn push_tag(request: PushTagRequest) -> Result<GitWriteResponse, String> {
    tauri::async_runtime::block_on(async_push_tag(request))
}

fn create_tag_request(
    repo: &std::path::Path,
    name: &str,
    target: &str,
    message: &str,
) -> CreateTagRequest {
    CreateTagRequest {
        path: repo.to_string_lossy().to_string(),
        name: name.to_string(),
        target: target.to_string(),
        message: message.to_string(),
    }
}

#[test]
fn create_lightweight_tag_at_head() {
    let repo = create_repo_with_tracked_file("tag-lightweight");
    let head = git_head(repo.path());

    let response = create_tag(create_tag_request(repo.path(), "v1.0.0", "HEAD", ""))
        .expect("create lightweight tag");

    assert_eq!(run_git(repo.path(), &["rev-parse", "v1.0.0"]), head);
    assert!(response
        .summary
        .tags
        .iter()
        .any(|tag| tag.name == "v1.0.0" && tag.ref_name == "refs/tags/v1.0.0"));
}

#[test]
fn create_annotated_tag_with_message() {
    let repo = create_repo_with_tracked_file("tag-annotated");
    let head = git_head(repo.path());

    create_tag(create_tag_request(
        repo.path(),
        "v1.1.0",
        "HEAD",
        "Release 1.1",
    ))
    .expect("create annotated tag");

    assert_eq!(run_git(repo.path(), &["rev-parse", "v1.1.0^{}"]), head);
    assert!(run_git(repo.path(), &["cat-file", "-p", "v1.1.0"]).contains("Release 1.1"));
}

#[test]
fn create_tag_rejects_invalid_names_and_nul_bytes() {
    let repo = create_repo_with_tracked_file("tag-invalid");

    let invalid_name = match create_tag(create_tag_request(repo.path(), "bad tag", "HEAD", "")) {
        Ok(_) => panic!("invalid tag name should be rejected"),
        Err(error) => error,
    };
    let nul_name = match create_tag(create_tag_request(repo.path(), "bad\0tag", "HEAD", "")) {
        Ok(_) => panic!("NUL tag name should be rejected"),
        Err(error) => error,
    };

    assert!(invalid_name.contains("Invalid tag name"));
    assert!(nul_name.contains("NUL"));
}

#[test]
fn delete_local_tag() {
    let repo = create_repo_with_tracked_file("tag-delete");
    create_tag(create_tag_request(repo.path(), "v1.2.0", "HEAD", ""))
        .expect("create tag");

    let response = delete_tag(DeleteTagRequest {
        path: repo.path_string(),
        name: "v1.2.0".to_string(),
    })
    .expect("delete tag");

    assert!(!response.summary.tags.iter().any(|tag| tag.name == "v1.2.0"));
    assert!(run_git(repo.path(), &["tag", "--list", "v1.2.0"]).is_empty());
}

#[test]
fn push_tag_to_configured_remote() {
    let (_seed, remote, clone) = create_clone_with_local_bare_remote();
    create_tag(create_tag_request(clone.path(), "v2.0.0", "HEAD", ""))
        .expect("create tag");

    push_tag(PushTagRequest {
        path: clone.path_string(),
        name: "v2.0.0".to_string(),
        remote: "origin".to_string(),
    })
    .expect("push tag");

    let remote_tag = run_git_dir(remote.path(), &["rev-parse", "refs/tags/v2.0.0"]);
    assert_eq!(remote_tag, git_head(clone.path()));
}
