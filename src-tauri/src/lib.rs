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
        "--date=iso-strict",
        "--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s",
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
            (parts.len() == 5).then(|| CommitInfo {
                hash: parts[0].to_string(),
                short_hash: parts[1].to_string(),
                author: parts[2].to_string(),
                date: parts[3].to_string(),
                subject: parts[4].to_string(),
            })
        })
        .collect())
}

fn git_branches(root: &Path) -> Result<Vec<BranchInfo>, String> {
    let current = git(root, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .unwrap_or_default()
        .trim()
        .to_string();
    let output = git(
        root,
        &[
            "for-each-ref",
            "--format=%(refname)\x1f%(refname:short)",
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
            if parts.len() != 2 || parts[1].ends_with("/HEAD") {
                return None;
            }

            let branch_type = if parts[0].starts_with("refs/remotes/") {
                "remote"
            } else {
                "local"
            };

            Some(BranchInfo {
                name: parts[1].to_string(),
                ref_name: parts[0].to_string(),
                branch_type: branch_type.to_string(),
                current: branch_type == "local" && parts[1] == current,
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
    let status = git(root, &["status", "--porcelain=v1"]).unwrap_or_default();

    let status_by_path: HashMap<String, String> =
        parse_status_entries(&status).into_iter().collect();
    let mut files = staged
        .lines()
        .chain(unstaged.lines())
        .filter_map(parse_name_status_line)
        .chain(
            status_by_path
                .iter()
                .filter(|(_, status)| status.as_str() == "untracked")
                .map(|(path, status)| TreeFile {
                    path: path.clone(),
                    status: Some(status.clone()),
                }),
        )
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

    Ok(
        match (staged.trim().is_empty(), unstaged.trim().is_empty()) {
            (true, true) => String::new(),
            (true, false) => unstaged,
            (false, true) => staged,
            (false, false) => format!("{staged}\n{unstaged}"),
        },
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            default_start_path,
            load_repository,
            get_diff,
            get_file_diff
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
