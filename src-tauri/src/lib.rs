use serde::Serialize;
use std::collections::HashMap;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RepositorySummary {
    root: String,
    branch: String,
    head: String,
    status_counts: StatusCounts,
    worktrees: Vec<WorktreeInfo>,
    branches: Vec<BranchInfo>,
    tags: Vec<TagInfo>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusCounts {
    added: usize,
    modified: usize,
    deleted: usize,
    renamed: usize,
    untracked: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeInfo {
    path: String,
    head: Option<String>,
    branch: Option<String>,
    detached: bool,
    bare: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BranchInfo {
    name: String,
    ref_name: String,
    branch_type: String,
    current: bool,
    ahead: Option<usize>,
    behind: Option<usize>,
    upstream: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TagInfo {
    name: String,
    ref_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CommitInfo {
    hash: String,
    short_hash: String,
    parents: Vec<String>,
    author: String,
    date: String,
    subject: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TreeFile {
    path: String,
    status: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryPayload {
    summary: RepositorySummary,
    commits: Vec<CommitInfo>,
    files: Vec<TreeFile>,
}

#[tauri::command]
fn default_start_path() -> Result<String, String> {
    env::current_dir()
        .or_else(|_| env::var("HOME").map(PathBuf::from))
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn load_repository(
    path: String,
    commit: Option<String>,
    branch: Option<String>,
) -> Result<RepositoryPayload, String> {
    let root = repository_root(&path)?;
    let summary = repository_summary(&root)?;
    let commits = git_log(&root, branch.as_deref())?;
    let files = changed_files(&root, commit.as_deref())?;

    Ok(RepositoryPayload {
        summary,
        commits,
        files,
    })
}

#[tauri::command]
fn get_diff(path: String, commit: Option<String>) -> Result<String, String> {
    let root = repository_root(&path)?;
    match commit {
        Some(hash) if !hash.trim().is_empty() => git_show(&root, hash.trim()),
        _ => git_diff(&root),
    }
}

#[tauri::command]
fn get_file_diff(
    path: String,
    commit: Option<String>,
    file_path: String,
) -> Result<String, String> {
    let root = repository_root(&path)?;
    match commit {
        Some(hash) if !hash.trim().is_empty() => git_show_file(&root, hash.trim(), &file_path),
        _ => git_worktree_file_diff(&root, &file_path),
    }
}

#[tauri::command]
fn fetch_remotes(path: String) -> Result<(), String> {
    let root = repository_root(&path)?;
    git(&root, &["fetch", "--all", "--prune"])?;
    Ok(())
}

fn repository_summary(root: &Path) -> Result<RepositorySummary, String> {
    let branch = git(root, &["branch", "--show-current"])
        .unwrap_or_default()
        .trim()
        .to_string();
    let head = git(root, &["rev-parse", "--short", "HEAD"])
        .unwrap_or_else(|_| "no commits".to_string())
        .trim()
        .to_string();
    let status = git(root, &["status", "--porcelain=v1"]).unwrap_or_default();
    let worktrees = parse_worktrees(&git(root, &["worktree", "list", "--porcelain"])?);
    let branches = git_branches(root)?;
    let tags = git_tags(root)?;

    Ok(RepositorySummary {
        root: root.to_string_lossy().to_string(),
        branch: if branch.is_empty() {
            "detached".to_string()
        } else {
            branch
        },
        head,
        status_counts: count_statuses(&status),
        worktrees,
        branches,
        tags,
    })
}

fn repository_root(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);
    if !candidate.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    let output = Command::new("git")
        .args([
            "-C",
            candidate.to_string_lossy().as_ref(),
            "rev-parse",
            "--show-toplevel",
        ])
        .output()
        .map_err(|error| format!("Failed to run git: {error}"))?;

    if !output.status.success() {
        return Err(stderr_or_status("Not a git repository", output.stderr));
    }

    Ok(PathBuf::from(
        String::from_utf8_lossy(&output.stdout).trim(),
    ))
}

fn git_log(root: &Path, branch: Option<&str>) -> Result<Vec<CommitInfo>, String> {
    let target = branch.filter(|value| !value.trim().is_empty());
    let mut args = vec![
        "log",
        "--topo-order",
        "--date=iso-strict",
        "--pretty=format:%H%x1f%h%x1f%P%x1f%an%x1f%ad%x1f%s",
        "-n",
        "120",
    ];

    if let Some(target) = target {
        args.push(target);
    }

    let output = git(root, &args).unwrap_or_default();

    Ok(output
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\x1f').collect();
            (parts.len() == 6).then(|| CommitInfo {
                hash: parts[0].to_string(),
                short_hash: parts[1].to_string(),
                parents: parts[2]
                    .split_whitespace()
                    .map(ToString::to_string)
                    .collect(),
                author: parts[3].to_string(),
                date: parts[4].to_string(),
                subject: parts[5].to_string(),
            })
        })
        .collect())
}

fn git_branches(root: &Path) -> Result<Vec<BranchInfo>, String> {
    let current = git(root, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .unwrap_or_default()
        .trim()
        .to_string();
    let current_ref = if current.is_empty() {
        None
    } else {
        Some(format!("refs/heads/{current}"))
    };
    let output = git(
        root,
        &[
            "for-each-ref",
            "--format=%(refname)\x1f%(refname:short)\x1f%(upstream)",
            "refs/heads",
            "refs/remotes",
        ],
    )?;

    let mut branches = output
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = if line.contains('\x1f') {
                line.split('\x1f').collect()
            } else {
                line.split("%x1f").collect()
            };
            if parts.len() != 3 || parts[1].ends_with("/HEAD") {
                return None;
            }

            let branch_type = if parts[0].starts_with("refs/remotes/") {
                "remote"
            } else {
                "local"
            };
            let upstream = (!parts[2].is_empty()).then(|| parts[2].to_string());
            let tracking_pair = if branch_type == "local" {
                upstream
                    .as_deref()
                    .map(|upstream_ref| (parts[0], upstream_ref))
            } else {
                current_ref.as_deref().and_then(|local_ref| {
                    remote_matches_branch(parts[1], &current).then_some((local_ref, parts[0]))
                })
            };
            let (ahead, behind) = tracking_pair
                .and_then(|(left, right)| rev_list_ahead_behind(root, left, right).ok())
                .map(|(ahead, behind)| (Some(ahead), Some(behind)))
                .unwrap_or((None, None));

            Some(BranchInfo {
                name: parts[1].to_string(),
                ref_name: parts[0].to_string(),
                branch_type: branch_type.to_string(),
                current: branch_type == "local" && parts[1] == current,
                ahead,
                behind,
                upstream,
            })
        })
        .collect::<Vec<_>>();

    branches.sort_by(|left, right| {
        left.branch_type
            .cmp(&right.branch_type)
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(branches)
}

fn remote_matches_branch(remote_short_name: &str, current: &str) -> bool {
    !current.is_empty()
        && remote_short_name
            .split_once('/')
            .map(|(_, branch_path)| branch_path == current)
            .unwrap_or(false)
}

fn rev_list_ahead_behind(root: &Path, left: &str, right: &str) -> Result<(usize, usize), String> {
    let range = format!("{left}...{right}");
    let output = git(root, &["rev-list", "--left-right", "--count", &range])?;
    let mut parts = output.split_whitespace();
    let ahead = parts
        .next()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let behind = parts
        .next()
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    Ok((ahead, behind))
}

fn git_tags(root: &Path) -> Result<Vec<TagInfo>, String> {
    let output = git(
        root,
        &[
            "for-each-ref",
            "--format=%(refname)\x1f%(refname:short)",
            "refs/tags",
        ],
    )?;

    let mut tags = output
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = if line.contains('\x1f') {
                line.split('\x1f').collect()
            } else {
                line.split("%x1f").collect()
            };
            (parts.len() == 2).then(|| TagInfo {
                name: parts[1].to_string(),
                ref_name: parts[0].to_string(),
            })
        })
        .collect::<Vec<_>>();

    tags.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(tags)
}

fn changed_files(root: &Path, commit: Option<&str>) -> Result<Vec<TreeFile>, String> {
    match commit {
        Some(hash) if !hash.trim().is_empty() => commit_changed_files(root, hash.trim()),
        _ => worktree_changed_files(root),
    }
}

fn commit_changed_files(root: &Path, hash: &str) -> Result<Vec<TreeFile>, String> {
    let parents = commit_parents(root, hash)?;
    if parents.len() > 1 {
        let output = git(root, &["diff", "--name-status", "-M", &parents[0], hash])?;
        return Ok(parse_name_status_entries(&output));
    }

    let output = git(
        root,
        &[
            "diff-tree",
            "--no-commit-id",
            "--name-status",
            "-r",
            "-M",
            "--root",
            hash,
        ],
    )?;
    Ok(parse_name_status_entries(&output))
}

fn worktree_changed_files(root: &Path) -> Result<Vec<TreeFile>, String> {
    let staged = git(root, &["diff", "--cached", "--name-status", "-M"])?;
    let unstaged = git(root, &["diff", "--name-status", "-M"])?;
    let status = git(root, &["status", "--porcelain=v1", "-uall"]).unwrap_or_default();
    let untracked = git(root, &["ls-files", "--others", "--exclude-standard"])?;

    let status_by_path: HashMap<String, String> =
        parse_status_entries(&status).into_iter().collect();
    let mut files = staged
        .lines()
        .chain(unstaged.lines())
        .filter_map(parse_name_status_line)
        .chain(untracked.lines().filter_map(|path| {
            let path = path.trim();
            (!path.is_empty()).then(|| TreeFile {
                path: path.to_string(),
                status: Some("untracked".to_string()),
            })
        }))
        .into_iter()
        .map(|mut file| {
            if file.status.is_none() {
                file.status = status_by_path.get(&file.path).cloned();
            }
            file
        })
        .collect::<Vec<_>>();

    files.sort_by(|left, right| left.path.cmp(&right.path));
    files.dedup_by(|left, right| left.path == right.path);
    Ok(files)
}

fn parse_name_status_entries(output: &str) -> Vec<TreeFile> {
    let mut files = output
        .lines()
        .filter_map(parse_name_status_line)
        .collect::<Vec<_>>();
    files.sort_by(|left, right| left.path.cmp(&right.path));
    files.dedup_by(|left, right| left.path == right.path);
    files
}

fn parse_name_status_line(line: &str) -> Option<TreeFile> {
    let mut parts = line.split('\t');
    let code = parts.next()?;
    let first_path = parts.next()?;
    let second_path = parts.next();
    let status = name_status_code_to_status(code);
    let path = if code.starts_with('R') || code.starts_with('C') {
        second_path.unwrap_or(first_path)
    } else {
        first_path
    };

    Some(TreeFile {
        path: normalize_git_path(path),
        status: Some(status.to_string()),
    })
}

fn name_status_code_to_status(code: &str) -> &'static str {
    match code.chars().next().unwrap_or('M') {
        'A' => "added",
        'D' => "deleted",
        'R' => "renamed",
        _ => "modified",
    }
}

fn normalize_git_path(path: &str) -> String {
    path.trim()
        .trim_matches('"')
        .strip_prefix("b/")
        .or_else(|| path.trim().trim_matches('"').strip_prefix("a/"))
        .unwrap_or_else(|| path.trim().trim_matches('"'))
        .to_string()
}

#[allow(dead_code)]
fn git_files(root: &Path) -> Result<Vec<TreeFile>, String> {
    let tracked = git(root, &["ls-files", "-co", "--exclude-standard"])?;
    let status = git(root, &["status", "--porcelain=v1"]).unwrap_or_default();
    let statuses = parse_status_entries(&status);

    let mut files: Vec<TreeFile> = tracked
        .lines()
        .filter(|path| !path.trim().is_empty())
        .map(|path| TreeFile {
            path: path.to_string(),
            status: statuses
                .iter()
                .find(|(status_path, _)| status_path == path)
                .map(|(_, status)| status.clone()),
        })
        .collect();

    files.sort_by(|left, right| left.path.cmp(&right.path));
    files.dedup_by(|left, right| left.path == right.path);
    Ok(files)
}

fn git_diff(root: &Path) -> Result<String, String> {
    let unstaged = git(root, &["diff", "--no-ext-diff", "--unified=80"])?;
    let staged = git(root, &["diff", "--cached", "--no-ext-diff", "--unified=80"])?;

    Ok(
        match (staged.trim().is_empty(), unstaged.trim().is_empty()) {
            (true, true) => String::new(),
            (true, false) => unstaged,
            (false, true) => staged,
            (false, false) => format!("{staged}\n{unstaged}"),
        },
    )
}

fn git_show(root: &Path, hash: &str) -> Result<String, String> {
    let parents = commit_parents(root, hash)?;
    if parents.len() > 1 {
        return git(
            root,
            &[
                "diff",
                "--no-ext-diff",
                "--unified=80",
                "--find-renames",
                &parents[0],
                hash,
            ],
        );
    }

    git(
        root,
        &[
            "show",
            "--format=",
            "--no-ext-diff",
            "--unified=80",
            "--find-renames",
            hash,
        ],
    )
}

fn git_show_file(root: &Path, hash: &str, file_path: &str) -> Result<String, String> {
    let parents = commit_parents(root, hash)?;
    if parents.len() > 1 {
        return git(
            root,
            &[
                "diff",
                "--no-ext-diff",
                "--unified=8",
                "--find-renames",
                &parents[0],
                hash,
                "--",
                file_path,
            ],
        );
    }

    git(
        root,
        &[
            "show",
            "--format=",
            "--no-ext-diff",
            "--unified=8",
            "--find-renames",
            hash,
            "--",
            file_path,
        ],
    )
}

fn commit_parents(root: &Path, hash: &str) -> Result<Vec<String>, String> {
    let output = git(root, &["show", "-s", "--format=%P", hash])?;
    Ok(output.split_whitespace().map(ToString::to_string).collect())
}

fn git_worktree_file_diff(root: &Path, file_path: &str) -> Result<String, String> {
    let unstaged = git(
        root,
        &["diff", "--no-ext-diff", "--unified=8", "--", file_path],
    )?;
    let staged = git(
        root,
        &[
            "diff",
            "--cached",
            "--no-ext-diff",
            "--unified=8",
            "--",
            file_path,
        ],
    )?;
    let untracked = is_untracked_file(root, file_path);

    Ok(
        match (staged.trim().is_empty(), unstaged.trim().is_empty()) {
            (true, true) if untracked => git_untracked_file_diff(root, file_path)?,
            (true, true) => String::new(),
            (true, false) => unstaged,
            (false, true) => staged,
            (false, false) => format!("{staged}\n{unstaged}"),
        },
    )
}

fn is_untracked_file(root: &Path, file_path: &str) -> bool {
    let output = git(
        root,
        &[
            "ls-files",
            "--others",
            "--exclude-standard",
            "--",
            file_path,
        ],
    )
    .unwrap_or_default();
    output.lines().any(|path| path == file_path)
}

fn git_untracked_file_diff(root: &Path, file_path: &str) -> Result<String, String> {
    git_allow_exit(
        root,
        &[
            "diff",
            "--no-index",
            "--no-ext-diff",
            "--unified=8",
            "--",
            "/dev/null",
            file_path,
        ],
        &[0, 1],
    )
}

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|error| format!("Failed to run git: {error}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(stderr_or_status("git command failed", output.stderr))
    }
}

fn git_allow_exit(root: &Path, args: &[&str], allowed_codes: &[i32]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|error| format!("Failed to run git: {error}"))?;

    if allowed_codes.contains(&output.status.code().unwrap_or(-1)) {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(stderr_or_status("git command failed", output.stderr))
    }
}

fn stderr_or_status(prefix: &str, stderr: Vec<u8>) -> String {
    let message = String::from_utf8_lossy(&stderr).trim().to_string();
    if message.is_empty() {
        prefix.to_string()
    } else {
        message
    }
}

fn count_statuses(status: &str) -> StatusCounts {
    let mut counts = StatusCounts::default();
    for (_, status) in parse_status_entries(status) {
        match status.as_str() {
            "added" => counts.added += 1,
            "modified" => counts.modified += 1,
            "deleted" => counts.deleted += 1,
            "renamed" => counts.renamed += 1,
            "untracked" => counts.untracked += 1,
            _ => {}
        }
    }
    counts
}

fn parse_status_entries(status: &str) -> Vec<(String, String)> {
    status
        .lines()
        .filter_map(|line| {
            if line.len() < 4 {
                return None;
            }

            let code = &line[..2];
            let raw_path = line[3..].trim();
            let path = raw_path
                .split(" -> ")
                .last()
                .unwrap_or(raw_path)
                .trim_matches('"')
                .to_string();
            let status = if code == "??" {
                "untracked"
            } else if code.contains('R') {
                "renamed"
            } else if code.contains('A') {
                "added"
            } else if code.contains('D') {
                "deleted"
            } else {
                "modified"
            };

            Some((path, status.to_string()))
        })
        .collect()
}

fn parse_worktrees(output: &str) -> Vec<WorktreeInfo> {
    let mut worktrees = Vec::new();
    let mut current: Option<WorktreeInfo> = None;

    for line in output.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            if let Some(worktree) = current.take() {
                worktrees.push(worktree);
            }
            current = Some(WorktreeInfo {
                path: path.to_string(),
                head: None,
                branch: None,
                detached: false,
                bare: false,
            });
        } else if let Some(worktree) = current.as_mut() {
            if let Some(head) = line.strip_prefix("HEAD ") {
                worktree.head = Some(head.to_string());
            } else if let Some(branch) = line.strip_prefix("branch refs/heads/") {
                worktree.branch = Some(branch.to_string());
            } else if line == "detached" {
                worktree.detached = true;
            } else if line == "bare" {
                worktree.bare = true;
            }
        }
    }

    if let Some(worktree) = current {
        worktrees.push(worktree);
    }

    worktrees
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn merge_commit_diff_uses_first_parent_unified_diff() {
        let repo = create_merge_repo();
        let merge_hash = run_git(&repo, &["rev-parse", "HEAD"]);

        let files = commit_changed_files(&repo, &merge_hash).expect("changed files");
        assert!(
            files.iter().any(|file| file.path == "feature.txt"),
            "merge diff should include changes introduced from the merged branch"
        );

        let full_diff = git_show(&repo, &merge_hash).expect("merge diff");
        assert!(full_diff.contains("diff --git a/feature.txt b/feature.txt"));
        assert!(
            !full_diff.contains("diff --cc"),
            "merge commits should render first-parent unified diffs, not combined diffs"
        );

        let file_diff = git_show_file(&repo, &merge_hash, "feature.txt").expect("file diff");
        assert!(file_diff.contains("diff --git a/feature.txt b/feature.txt"));
        assert!(file_diff.contains("+feature"));

        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn worktree_file_diff_renders_untracked_files() {
        let repo = create_basic_repo();
        fs::write(repo.join("new-file.txt"), "first\nsecond\n").expect("write untracked file");
        fs::create_dir_all(repo.join("new-dir")).expect("create untracked directory");
        fs::write(repo.join("new-dir").join("nested.txt"), "nested\n")
            .expect("write nested untracked file");

        let files = worktree_changed_files(&repo).expect("changed files");
        assert!(
            files
                .iter()
                .any(|file| file.path == "new-file.txt"
                    && file.status.as_deref() == Some("untracked")),
            "untracked file should appear in the changed file tree"
        );
        assert!(
            files.iter().any(|file| file.path == "new-dir/nested.txt"
                && file.status.as_deref() == Some("untracked")),
            "nested untracked file should appear in the changed file tree"
        );

        let diff = git_worktree_file_diff(&repo, "new-file.txt").expect("untracked diff");
        assert!(diff.contains("diff --git"));
        assert!(diff.contains("+first"));
        assert!(diff.contains("+second"));
        let nested_diff =
            git_worktree_file_diff(&repo, "new-dir/nested.txt").expect("nested untracked diff");
        assert!(nested_diff.contains("diff --git"));
        assert!(nested_diff.contains("+nested"));

        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn branch_tracking_counts_remote_ahead_of_current_branch() {
        let remote = create_basic_repo();
        fs::write(remote.join("base.txt"), "base\n").expect("write base");
        run_git(&remote, &["add", "."]);
        run_git(&remote, &["commit", "-m", "base"]);

        let clone = unique_temp_repo_path();
        run_git_global(&[
            "clone",
            remote.to_string_lossy().as_ref(),
            clone.to_string_lossy().as_ref(),
        ]);

        fs::write(remote.join("remote.txt"), "remote\n").expect("write remote");
        run_git(&remote, &["add", "."]);
        run_git(&remote, &["commit", "-m", "remote"]);
        run_git(&clone, &["fetch", "--all", "--prune"]);

        let branches = git_branches(&clone).expect("branches");
        let local_main = branches
            .iter()
            .find(|branch| branch.ref_name == "refs/heads/main")
            .expect("local main");
        assert_eq!(local_main.ahead, Some(0));
        assert_eq!(local_main.behind, Some(1));
        assert_eq!(
            local_main.upstream.as_deref(),
            Some("refs/remotes/origin/main")
        );

        let remote_main = branches
            .iter()
            .find(|branch| branch.ref_name == "refs/remotes/origin/main")
            .expect("remote main");
        assert_eq!(remote_main.ahead, Some(0));
        assert_eq!(remote_main.behind, Some(1));

        fs::remove_dir_all(remote).ok();
        fs::remove_dir_all(clone).ok();
    }

    #[test]
    fn remote_branch_match_uses_full_branch_path_after_remote_name() {
        assert!(remote_matches_branch("origin/feature/foo", "feature/foo"));
        assert!(!remote_matches_branch("origin/feature/foo", "foo"));
    }

    fn create_merge_repo() -> PathBuf {
        let repo = create_basic_repo();

        fs::write(repo.join("base.txt"), "base\n").expect("write base");
        run_git(&repo, &["add", "."]);
        run_git(&repo, &["commit", "-m", "base"]);

        run_git(&repo, &["checkout", "-b", "feature"]);
        fs::write(repo.join("feature.txt"), "feature\n").expect("write feature");
        run_git(&repo, &["add", "."]);
        run_git(&repo, &["commit", "-m", "feature"]);

        run_git(&repo, &["checkout", "main"]);
        fs::write(repo.join("main.txt"), "main\n").expect("write main");
        run_git(&repo, &["add", "."]);
        run_git(&repo, &["commit", "-m", "main"]);

        run_git(
            &repo,
            &["merge", "--no-ff", "feature", "-m", "merge feature"],
        );
        repo
    }

    fn create_basic_repo() -> PathBuf {
        let repo = unique_temp_repo_path();
        fs::create_dir_all(&repo).expect("create temp repo");

        run_git(&repo, &["init", "--initial-branch=main"]);
        run_git(&repo, &["config", "user.email", "view@example.test"]);
        run_git(&repo, &["config", "user.name", "View Test"]);
        repo
    }

    fn unique_temp_repo_path() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        env::temp_dir().join(format!("view-merge-test-{}-{nanos}", std::process::id()))
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
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            default_start_path,
            load_repository,
            get_diff,
            get_file_diff,
            fetch_remotes
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
