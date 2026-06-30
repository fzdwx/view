use super::{get_commit_details as async_get_commit_details, GetCommitDetailsRequest};
use std::fs;

#[path = "git_commit_push_test_support.rs"]
mod support;

use support::{create_repo_with_tracked_file, run_git};

fn get_commit_details(request: GetCommitDetailsRequest) -> Result<super::CommitDetails, String> {
    tauri::async_runtime::block_on(async_get_commit_details(request))
}

fn details_request(repo: &std::path::Path, commit: &str) -> GetCommitDetailsRequest {
    GetCommitDetailsRequest {
        path: repo.to_string_lossy().to_string(),
        commit: commit.to_string(),
    }
}

#[test]
fn commit_details_include_full_message_parents_refs_and_unsigned_status() {
    let repo = create_repo_with_tracked_file("commit-details");
    fs::write(repo.path().join("tracked.txt"), "details\n").expect("modify tracked");
    run_git(repo.path(), &["add", "tracked.txt"]);
    run_git(
        repo.path(),
        &[
            "commit",
            "-m",
            "subject line",
            "-m",
            "body line one\nbody line two",
        ],
    );
    run_git(repo.path(), &["tag", "v-details"]);
    let head = run_git(repo.path(), &["rev-parse", "HEAD"]);
    let parent = run_git(repo.path(), &["rev-parse", "HEAD^"]);

    let details = get_commit_details(details_request(repo.path(), "HEAD")).expect("details");

    assert_eq!(details.hash, head);
    assert_eq!(details.subject, "subject line");
    assert!(details.body.contains("body line one"));
    assert_eq!(details.parents, vec![parent]);
    assert!(details
        .refs
        .iter()
        .any(|name| name == "refs/tags/v-details"));
    assert_eq!(details.signature.status, "unsigned");
    assert_eq!(
        details.compare_base.as_deref(),
        details.parents.first().map(String::as_str)
    );
}
