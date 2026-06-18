use alacritty_terminal::event::{Event as TerminalEvent, EventListener};
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::index::{Column, Line};
use alacritty_terminal::term::cell::{Cell, Flags};
use alacritty_terminal::term::test::TermSize;
use alacritty_terminal::term::{Config as TerminalConfig, Term, TermMode};
use alacritty_terminal::vte::ansi::{Color as TerminalColorValue, NamedColor};
use alacritty_terminal::vte::ansi::{
    Processor as TerminalProcessor, StdSyncHandler as TerminalSyncHandler,
};
use base64::{engine::general_purpose, Engine as _};
use fff_search::{
    FFFMode, FilePicker, FilePickerOptions, FuzzySearchOptions, GrepConfig, GrepMode,
    GrepSearchOptions, PaginationArgs, QueryParser, SharedFilePicker, SharedFrecency,
};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::env;
use std::fs;
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    mpsc, Arc, Mutex,
};
use std::thread;
use std::time::Duration;
use tauri::{LogicalSize, Manager, State};
use tungstenite::{accept, Error as WsError, Message, WebSocket};

mod git_pathspec;
mod git_commit_push;
mod git_restore;
mod git_status;
mod git_write;
mod wsl;

use git_status::{
    count_statuses, normalize_git_path, parse_name_status_entries, parse_porcelain_v1_z_status,
    StatusCounts, TreeFile, WORKTREE_STATUS_ARGS,
};

const MAX_TEXT_FILE_BYTES: u64 = 1_048_576;
const MAX_MEDIA_FILE_BYTES: u64 = 5_242_880;
const DEFAULT_FILE_SEARCH_LIMIT: usize = 50;
const MAX_FILE_SEARCH_LIMIT: usize = 200;
const FILE_SEARCH_SCAN_TIMEOUT: Duration = Duration::from_secs(10);
const TERMINAL_WS_IDLE_SLEEP_MS: u64 = 1;
const TERMINAL_WS_PENDING_OUTPUT_LIMIT: usize = 64;
const TERMINAL_WS_OUTPUT_BURST_LIMIT: usize = 8;

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
struct RepositoryPayload {
    summary: RepositorySummary,
    commits: Vec<CommitInfo>,
    files: Vec<TreeFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileContent {
    path: String,
    content: String,
    binary: bool,
    too_large: bool,
    media_type: Option<String>,
    media_data_url: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileSearchResult {
    path: String,
    score: i32,
    line_number: Option<usize>,
    line_text: Option<String>,
    context_before: Vec<String>,
    context_after: Vec<String>,
    match_ranges: Vec<(u32, u32)>,
}

#[derive(Clone)]
struct EditorTextMatchRange {
    start_byte: usize,
    end_byte: usize,
    start_utf16: usize,
    end_utf16: usize,
    line_number: usize,
    line_text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EditorTextMatch {
    start: usize,
    end: usize,
    line_number: usize,
    line_text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EditorSearchResponse {
    matches: Vec<EditorTextMatch>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EditorReplaceResponse {
    content: String,
    matches: Vec<EditorTextMatch>,
    selection_start: usize,
    selection_end: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveFileRequest {
    path: String,
    file_path: String,
    base_content: String,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveConflict {
    path: String,
    base_content: String,
    current_content: String,
    proposed_content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveFileResponse {
    status: String,
    file: Option<FileContent>,
    conflict: Option<SaveConflict>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalSessionInfo {
    id: String,
    cwd: String,
    pid: Option<u32>,
    ws_url: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemFontInfo {
    family: String,
    monospace: bool,
}

enum TerminalWsEvent {
    Frame(String),
    Close(Option<u32>),
}

enum TerminalParserEvent {
    Output(Vec<u8>),
    Resize(u16, u16),
}

#[derive(Clone)]
enum TerminalUiEvent {
    Title(Option<String>),
}

struct TerminalSession {
    parser_tx: mpsc::Sender<TerminalParserEvent>,
    ws_shutdown_tx: mpsc::Sender<()>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    master: Box<dyn MasterPty + Send>,
}

#[derive(Clone)]
struct TerminalEventProxy {
    input_tx: mpsc::Sender<Vec<u8>>,
    ui_event_tx: mpsc::Sender<TerminalUiEvent>,
}

impl EventListener for TerminalEventProxy {
    fn send_event(&self, event: TerminalEvent) {
        match event {
            TerminalEvent::PtyWrite(text) => {
                let _ = self.input_tx.send(text.into_bytes());
            }
            TerminalEvent::Title(title) => {
                let _ = self.ui_event_tx.send(TerminalUiEvent::Title(Some(title)));
            }
            TerminalEvent::ResetTitle => {
                let _ = self.ui_event_tx.send(TerminalUiEvent::Title(None));
            }
            _ => {}
        }
    }
}

#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalRunStyle {
    fg: Option<String>,
    bg: Option<String>,
    bold: bool,
    dim: bool,
    italic: bool,
    underline: bool,
    inverse: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalFrameRun {
    text: String,
    #[serde(flatten)]
    style: TerminalRunStyle,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalFrameLine {
    cells: Vec<TerminalFrameRun>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalFrameModes {
    app_cursor: bool,
    app_keypad: bool,
    bracketed_paste: bool,
    focus_in_out: bool,
    mouse_report_click: bool,
    mouse_drag: bool,
    mouse_motion: bool,
    sgr_mouse: bool,
    utf8_mouse: bool,
    alt_screen: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalFrame {
    #[serde(rename = "type")]
    message_type: &'static str,
    title: Option<String>,
    rows: usize,
    cols: usize,
    cursor_row: usize,
    cursor_col: usize,
    cursor_visible: bool,
    modes: TerminalFrameModes,
    lines: Vec<TerminalFrameLine>,
}

#[derive(Default)]
struct TerminalState {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
    next_id: AtomicU64,
}

#[tauri::command]
fn default_start_path() -> Result<String, String> {
    env::current_dir()
        .or_else(|_| env::var("HOME").map(PathBuf::from))
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_system_fonts() -> Vec<SystemFontInfo> {
    system_fonts()
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
fn get_commits(path: String, branch: Option<String>) -> Result<Vec<CommitInfo>, String> {
    let root = repository_root(&path)?;
    git_log(&root, branch.as_deref())
}

#[tauri::command]
fn get_project_files(path: String) -> Result<Vec<TreeFile>, String> {
    let root = repository_root(&path)?;
    git_files(&root)
}

#[tauri::command]
fn get_file_content(path: String, file_path: String) -> Result<FileContent, String> {
    let root = repository_root(&path)?;
    read_file_content(&root, &file_path)
}

#[tauri::command]
fn save_file_content(request: SaveFileRequest) -> Result<SaveFileResponse, String> {
    let root = repository_root(&request.path)?;
    write_file_content(
        &root,
        &request.file_path,
        &request.base_content,
        &request.content,
    )
}

#[tauri::command]
fn create_project_file(path: String, file_path: String) -> Result<String, String> {
    let root = repository_root(&path)?;
    create_repo_file(&root, &file_path)
}

#[tauri::command]
fn rename_project_file(path: String, from_path: String, to_path: String) -> Result<String, String> {
    let root = repository_root(&path)?;
    rename_repo_file(&root, &from_path, &to_path)
}

#[tauri::command]
fn delete_project_file(path: String, file_path: String) -> Result<(), String> {
    let root = repository_root(&path)?;
    delete_repo_file(&root, &file_path)
}

#[tauri::command]
fn search_file_names(
    path: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<FileSearchResult>, String> {
    let root = repository_root(&path)?;
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit
        .unwrap_or(DEFAULT_FILE_SEARCH_LIMIT)
        .clamp(1, MAX_FILE_SEARCH_LIMIT);
    let shared_picker = SharedFilePicker::default();
    let shared_frecency = SharedFrecency::default();
    FilePicker::new_with_shared_state(
        shared_picker.clone(),
        shared_frecency,
        FilePickerOptions {
            base_path: root.to_string_lossy().to_string(),
            mode: FFFMode::Ai,
            watch: false,
            ..Default::default()
        },
    )
    .map_err(|error| error.to_string())?;
    if !shared_picker.wait_for_scan(FILE_SEARCH_SCAN_TIMEOUT) {
        return Err("Timed out while indexing files for search".to_string());
    }
    let parsed_query = QueryParser::default().parse(query);
    let picker_guard = shared_picker.read().map_err(|error| error.to_string())?;
    let picker = picker_guard
        .as_ref()
        .ok_or_else(|| "File search index was not initialized".to_string())?;
    let file_results = picker.fuzzy_search(
        &parsed_query,
        None,
        FuzzySearchOptions {
            max_threads: 0,
            current_file: None,
            project_path: Some(root.as_path()),
            pagination: PaginationArgs { offset: 0, limit },
            ..Default::default()
        },
    );
    let results = file_results
        .items
        .iter()
        .zip(file_results.scores.iter())
        .map(|(item, score)| FileSearchResult {
            path: item.relative_path(picker).replace('\\', "/"),
            score: score.total,
            line_number: None,
            line_text: None,
            context_before: Vec::new(),
            context_after: Vec::new(),
            match_ranges: Vec::new(),
        })
        .fold(Vec::<FileSearchResult>::new(), |mut results, result| {
            if results.iter().all(|current| current.path != result.path) {
                results.push(result);
            }
            results
        });
    Ok(results)
}

#[tauri::command]
fn search_file_contents(
    path: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<FileSearchResult>, String> {
    let root = repository_root(&path)?;
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit
        .unwrap_or(DEFAULT_FILE_SEARCH_LIMIT)
        .clamp(1, MAX_FILE_SEARCH_LIMIT);
    let shared_picker = SharedFilePicker::default();
    let shared_frecency = SharedFrecency::default();
    FilePicker::new_with_shared_state(
        shared_picker.clone(),
        shared_frecency,
        FilePickerOptions {
            base_path: root.to_string_lossy().to_string(),
            mode: FFFMode::Ai,
            watch: false,
            ..Default::default()
        },
    )
    .map_err(|error| error.to_string())?;
    if !shared_picker.wait_for_scan(FILE_SEARCH_SCAN_TIMEOUT) {
        return Err("Timed out while indexing files for search".to_string());
    }
    let grep_query = QueryParser::new(GrepConfig).parse(query);
    let picker_guard = shared_picker.read().map_err(|error| error.to_string())?;
    let picker = picker_guard
        .as_ref()
        .ok_or_else(|| "File search index was not initialized".to_string())?;
    let grep_results = picker.grep(
        &grep_query,
        &GrepSearchOptions {
            max_matches_per_file: 1,
            page_limit: limit,
            mode: GrepMode::PlainText,
            time_budget_ms: 400,
            before_context: 2,
            after_context: 2,
            trim_whitespace: true,
            ..Default::default()
        },
    );
    let mut results = Vec::new();
    for matched in &grep_results.matches {
        let Some(file) = grep_results.files.get(matched.file_index) else {
            continue;
        };
        results.push(FileSearchResult {
            path: file.relative_path(picker).replace('\\', "/"),
            score: matched.fuzzy_score.map(i32::from).unwrap_or(0),
            line_number: Some(matched.line_number as usize),
            line_text: Some(matched.line_content.clone()),
            context_before: matched.context_before.clone(),
            context_after: matched.context_after.clone(),
            match_ranges: matched.match_byte_offsets.iter().map(|(s, e)| (*s, *e)).collect(),
        });
        if results.len() >= limit {
            break;
        }
    }
    Ok(results)
}

#[tauri::command]
fn search_editor_text(content: String, query: String) -> Result<EditorSearchResponse, String> {
    Ok(EditorSearchResponse {
        matches: editor_text_matches(&content, &query)
            .into_iter()
            .map(EditorTextMatch::from)
            .collect(),
    })
}

#[tauri::command]
fn replace_editor_text(
    content: String,
    query: String,
    replacement: String,
    active_index: usize,
    replace_all: bool,
) -> Result<EditorReplaceResponse, String> {
    Ok(replace_editor_content(
        &content,
        &query,
        &replacement,
        active_index,
        replace_all,
    ))
}

#[tauri::command]
fn fetch_remotes(path: String) -> Result<(), String> {
    let root = repository_root(&path)?;
    git(&root, &["fetch", "--all", "--prune"])?;
    Ok(())
}

#[tauri::command]
fn checkout_branch(path: String, ref_name: String) -> Result<(), String> {
    let root = repository_root(&path)?;
    checkout_branch_ref(&root, &ref_name)
}

#[tauri::command]
fn create_branch(path: String, name: String, start_point: String) -> Result<(), String> {
    let root = repository_root(&path)?;
    validate_branch_name(&root, &name)?;
    validate_branch_start_point(&start_point)?;
    git(&root, &["switch", "-c", &name, &start_point])?;
    Ok(())
}

#[tauri::command]
fn rename_branch(path: String, ref_name: String, new_name: String) -> Result<(), String> {
    let root = repository_root(&path)?;
    let current = current_branch(&root);
    let branch = local_branch_name(&ref_name)?;
    validate_branch_name(&root, &new_name)?;
    if current.as_deref() == Some(branch.as_str()) {
        git(&root, &["branch", "-m", &new_name])?;
    } else {
        git(&root, &["branch", "-m", &branch, &new_name])?;
    }
    Ok(())
}

#[tauri::command]
fn delete_branch(path: String, ref_name: String, force: bool) -> Result<(), String> {
    let root = repository_root(&path)?;
    let current = current_branch(&root);
    let branch = local_branch_name(&ref_name)?;
    if current.as_deref() == Some(branch.as_str()) {
        return Err("Cannot delete the checked-out branch".to_string());
    }
    let flag = if force { "-D" } else { "-d" };
    git(&root, &["branch", flag, &branch])?;
    Ok(())
}

fn system_fonts() -> Vec<SystemFontInfo> {
    let mut database = fontdb::Database::new();
    database.load_system_fonts();

    let mut families = BTreeMap::<String, bool>::new();
    for face in database.faces() {
        for (family, _) in &face.families {
            let family = family.trim();
            if family.is_empty() {
                continue;
            }
            families
                .entry(family.to_string())
                .and_modify(|monospace| *monospace |= face.monospaced)
                .or_insert(face.monospaced);
        }
    }

    families
        .into_iter()
        .map(|(family, monospace)| SystemFontInfo { family, monospace })
        .collect()
}

#[tauri::command]
fn pull_current_branch(path: String, mode: String) -> Result<(), String> {
    let root = repository_root(&path)?;
    let branch = current_branch(&root).unwrap_or_default();
    if branch.is_empty() {
        return Err("Cannot pull while HEAD is detached".to_string());
    }

    match mode.as_str() {
        "merge" => git(&root, &["pull", "--no-rebase"])?,
        "rebase" => git(&root, &["pull", "--rebase"])?,
        _ => return Err("Pull mode must be merge or rebase".to_string()),
    };
    Ok(())
}

#[tauri::command]
fn terminal_spawn(
    state: State<TerminalState>,
    path: String,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<TerminalSessionInfo, String> {
    let root = repository_root(&path)?;
    spawn_terminal_session(state.inner(), &root, cwd.as_deref(), cols, rows)
}

#[tauri::command]
fn terminal_resize(
    state: State<TerminalState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.sessions.lock().map_err(|error| error.to_string())?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| "Terminal session was not found".to_string())?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Failed to resize terminal: {error}"))?;
    let _ = session
        .parser_tx
        .send(TerminalParserEvent::Resize(cols.max(1), rows.max(1)));
    Ok(())
}

#[tauri::command]
fn terminal_kill(state: State<TerminalState>, id: String) -> Result<(), String> {
    kill_terminal_session(state.inner(), &id)
}

fn kill_terminal_session(state: &TerminalState, id: &str) -> Result<(), String> {
    let session = {
        let mut sessions = state.sessions.lock().map_err(|error| error.to_string())?;
        sessions
            .remove(id)
            .ok_or_else(|| "Terminal session was not found".to_string())?
    };
    let _ = session.ws_shutdown_tx.send(());
    let mut killer = session.killer.lock().map_err(|error| error.to_string())?;
    killer
        .kill()
        .map_err(|error| format!("Failed to kill terminal: {error}"))
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
    let status = git(root, WORKTREE_STATUS_ARGS).unwrap_or_default();
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
        status_counts: count_statuses(&status).unwrap_or_default(),
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
                    .map(|upstream_ref| (parts[0].to_string(), upstream_ref.to_string()))
            } else {
                local_ref_for_remote_branch(root, parts[1])
                    .map(|local_ref| (local_ref, parts[0].to_string()))
                    .or_else(|| {
                        current_ref.as_deref().and_then(|local_ref| {
                            remote_matches_branch(parts[1], &current)
                                .then_some((local_ref.to_string(), parts[0].to_string()))
                        })
                    })
            };
            let (ahead, behind) = tracking_pair
                .and_then(|(left, right)| rev_list_ahead_behind(root, &left, &right).ok())
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

fn current_branch(root: &Path) -> Option<String> {
    let branch = git(root, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .unwrap_or_default()
        .trim()
        .to_string();
    (!branch.is_empty()).then_some(branch)
}

fn local_ref_for_remote_branch(root: &Path, remote_short_name: &str) -> Option<String> {
    let (_, branch_path) = remote_short_name.split_once('/')?;
    let local_ref = format!("refs/heads/{branch_path}");
    git(root, &["show-ref", "--verify", "--quiet", &local_ref])
        .is_ok()
        .then_some(local_ref)
}

fn local_branch_name(ref_name: &str) -> Result<String, String> {
    ref_name
        .strip_prefix("refs/heads/")
        .filter(|branch| !branch.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| "This operation requires a local branch".to_string())
}

fn remote_branch_short_name(ref_name: &str) -> Result<String, String> {
    ref_name
        .strip_prefix("refs/remotes/")
        .filter(|branch| !branch.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| "This operation requires a remote branch".to_string())
}

fn validate_branch_start_point(ref_name: &str) -> Result<(), String> {
    if ref_name.starts_with("refs/heads/")
        || ref_name.starts_with("refs/remotes/")
        || ref_name.starts_with("refs/tags/")
    {
        Ok(())
    } else {
        Err("Branch start point must be a branch or tag ref".to_string())
    }
}

fn validate_branch_name(root: &Path, name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed != name || trimmed.is_empty() {
        return Err("Branch name cannot be empty or padded with spaces".to_string());
    }
    git(root, &["check-ref-format", "--branch", name])?;
    Ok(())
}

fn checkout_branch_ref(root: &Path, ref_name: &str) -> Result<(), String> {
    if ref_name.starts_with("refs/heads/") {
        let branch = local_branch_name(ref_name)?;
        git(root, &["switch", &branch])?;
        return Ok(());
    }

    if ref_name.starts_with("refs/remotes/") {
        let remote_short = remote_branch_short_name(ref_name)?;
        let local_name = remote_short
            .split_once('/')
            .map(|(_, branch_path)| branch_path.to_string())
            .ok_or_else(|| "Remote branch name must include a remote".to_string())?;
        let local_ref = format!("refs/heads/{local_name}");
        if git(root, &["show-ref", "--verify", "--quiet", &local_ref]).is_ok() {
            git(root, &["switch", &local_name])?;
        } else {
            git(root, &["switch", "--track", &remote_short])?;
        }
        return Ok(());
    }

    Err("Checkout target must be a local or remote branch".to_string())
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
    let status = git(root, WORKTREE_STATUS_ARGS)?;

    parse_porcelain_v1_z_status(&status)
}

fn normalize_user_repo_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim().trim_matches('"').replace('\\', "/");
    if trimmed
        .split('/')
        .next()
        .is_some_and(|part| part.len() == 2 && part.ends_with(':'))
    {
        return Err("Use a path relative to the repository root".to_string());
    }

    let mut parts = Vec::new();
    for part in trimmed.split('/') {
        let part = part.trim();
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            return Err("File path cannot contain ..".to_string());
        }
        validate_cross_platform_path_part(part)?;
        parts.push(part);
    }

    if parts.is_empty() {
        return Err("File path is required".to_string());
    }

    Ok(parts.join("/"))
}

fn validate_cross_platform_path_part(part: &str) -> Result<(), String> {
    if part.chars().any(|character| {
        matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*') || character.is_control()
    }) {
        return Err("File path contains characters that are invalid on Windows".to_string());
    }
    if part.ends_with(' ') || part.ends_with('.') {
        return Err("File path cannot contain names ending with a space or dot".to_string());
    }

    let stem = part.split('.').next().unwrap_or(part).to_ascii_uppercase();
    let reserved = matches!(
        stem.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    );
    if reserved {
        return Err("File path contains a Windows reserved name".to_string());
    }

    Ok(())
}

fn git_files(root: &Path) -> Result<Vec<TreeFile>, String> {
    let tracked = git(root, &["ls-files", "-co", "--exclude-standard"])?;
    let status = git(root, WORKTREE_STATUS_ARGS).unwrap_or_default();
    let mut statuses_by_path = parse_porcelain_v1_z_status(&status)
        .unwrap_or_default()
        .into_iter()
        .map(|file| (file.path.clone(), file))
        .collect::<HashMap<_, _>>();

    let mut files: Vec<TreeFile> = tracked
        .lines()
        .filter(|path| !path.trim().is_empty())
        .map(|path| {
            statuses_by_path.remove(path).unwrap_or_else(|| TreeFile {
                path: path.to_string(),
                ..TreeFile::default()
            })
        })
        .collect();

    files.extend(statuses_by_path.into_values());

    files.sort_by(|left, right| left.path.cmp(&right.path));
    files.dedup_by(|left, right| left.path == right.path);
    Ok(files)
}

fn resolve_existing_repo_file(root: &Path, file_path: &str) -> Result<(String, PathBuf), String> {
    let normalized = normalize_git_path(file_path);
    let full_path = resolve_repo_child_path(root, &normalized)?;
    let canonical = full_path
        .canonicalize()
        .map_err(|error| format!("Failed to open file: {error}"))?;
    if !canonical.is_file() {
        return Err("Selected path is not a file".to_string());
    }

    Ok((normalized, canonical))
}

fn resolve_repo_child_path(root: &Path, normalized: &str) -> Result<PathBuf, String> {
    if normalized.is_empty() || Path::new(normalized).is_absolute() {
        return Err("Invalid file path".to_string());
    }

    let root = root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve repository root: {error}"))?;
    let full_path = root.join(normalized);
    let parent = full_path
        .parent()
        .ok_or_else(|| "Selected file has no parent directory".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| format!("Failed to resolve parent directory: {error}"))?;
    if !canonical_parent.starts_with(&root) {
        return Err("File is outside the repository".to_string());
    }

    Ok(full_path)
}

fn resolve_new_repo_child_path(root: &Path, normalized: &str) -> Result<PathBuf, String> {
    if normalized.is_empty() || Path::new(normalized).is_absolute() {
        return Err("Invalid file path".to_string());
    }

    let root = root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve repository root: {error}"))?;
    let mut current = root.clone();
    for part in normalized.split('/') {
        current.push(part);
        if !current.exists() {
            break;
        }

        let canonical = current
            .canonicalize()
            .map_err(|error| format!("Failed to resolve path: {error}"))?;
        if !canonical.starts_with(&root) {
            return Err("File is outside the repository".to_string());
        }
    }

    Ok(root.join(normalized))
}

fn create_repo_file(root: &Path, file_path: &str) -> Result<String, String> {
    let normalized = normalize_user_repo_path(file_path)?;
    let full_path = resolve_new_repo_child_path(root, &normalized)?;
    if full_path.exists() {
        return Err("File already exists".to_string());
    }

    let parent = full_path
        .parent()
        .ok_or_else(|| "Selected file has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("Failed to create directories: {error}"))?;
    fs::write(&full_path, []).map_err(|error| format!("Failed to create file: {error}"))?;
    Ok(normalized)
}

fn rename_repo_file(root: &Path, from_path: &str, to_path: &str) -> Result<String, String> {
    let (_, source) = resolve_existing_repo_file(root, from_path)?;
    let normalized_to = normalize_user_repo_path(to_path)?;
    let destination = resolve_repo_child_path(root, &normalized_to)?;
    if destination.exists() {
        return Err("Destination already exists".to_string());
    }
    let parent = destination
        .parent()
        .ok_or_else(|| "Selected file has no parent directory".to_string())?;
    if !parent.exists() {
        return Err("Destination directory does not exist".to_string());
    }

    fs::rename(&source, &destination).map_err(|error| format!("Failed to rename file: {error}"))?;
    Ok(normalized_to)
}

fn delete_repo_file(root: &Path, file_path: &str) -> Result<(), String> {
    let (_, canonical) = resolve_existing_repo_file(root, file_path)?;
    fs::remove_file(&canonical).map_err(|error| format!("Failed to delete file: {error}"))
}

fn read_file_content(root: &Path, file_path: &str) -> Result<FileContent, String> {
    let (normalized, canonical) = resolve_existing_repo_file(root, file_path)?;
    let metadata = fs::metadata(&canonical)
        .map_err(|error| format!("Failed to read file metadata: {error}"))?;
    let media_type = media_type_for_path(&canonical).map(str::to_string);
    let max_bytes = if media_type.is_some() {
        MAX_MEDIA_FILE_BYTES
    } else {
        MAX_TEXT_FILE_BYTES
    };

    if metadata.len() > max_bytes {
        return Ok(FileContent {
            path: normalized,
            content: String::new(),
            binary: media_type.is_some(),
            too_large: true,
            media_type,
            media_data_url: None,
        });
    }

    let bytes = fs::read(&canonical).map_err(|error| format!("Failed to read file: {error}"))?;
    let media_data_url = media_type
        .as_deref()
        .map(|mime_type| media_data_url(mime_type, &bytes));

    if bytes.contains(&0) {
        return Ok(FileContent {
            path: normalized,
            content: String::new(),
            binary: true,
            too_large: false,
            media_type,
            media_data_url,
        });
    }

    Ok(FileContent {
        path: normalized,
        content: String::from_utf8_lossy(&bytes).to_string(),
        binary: false,
        too_large: false,
        media_type,
        media_data_url,
    })
}

fn git_show_bytes(root: &Path, ref_spec: &str, file_path: &str) -> Result<Vec<u8>, String> {
    let spec = format!("{ref_spec}:{file_path}");
    let output = Command::new("git")
        .arg("-c")
        .arg("core.quotepath=false")
        .arg("-C")
        .arg(root)
        .args(["show", &spec])
        .output()
        .map_err(|error| format!("Failed to run git: {error}"))?;

    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(stderr_or_status("git command failed", output.stderr))
    }
}

fn read_file_content_at_ref(
    root: &Path,
    file_path: &str,
    ref_name: &str,
) -> Result<FileContent, String> {
    let media_type = media_type_for_path(Path::new(file_path)).map(str::to_string);
    let max_bytes = if media_type.is_some() {
        MAX_MEDIA_FILE_BYTES
    } else {
        MAX_TEXT_FILE_BYTES
    };

    let bytes = git_show_bytes(root, ref_name, file_path)?;

    if bytes.len() as u64 > max_bytes {
        return Ok(FileContent {
            path: file_path.to_string(),
            content: String::new(),
            binary: media_type.is_some(),
            too_large: true,
            media_type,
            media_data_url: None,
        });
    }

    let media_data_url = media_type
        .as_deref()
        .map(|mime_type| media_data_url(mime_type, &bytes));

    Ok(FileContent {
        path: file_path.to_string(),
        content: String::new(),
        binary: true,
        too_large: false,
        media_type,
        media_data_url,
    })
}

#[tauri::command]
fn get_file_blob(
    path: String,
    file_path: String,
    ref_name: Option<String>,
) -> Result<FileContent, String> {
    let root = repository_root(&path)?;
    match ref_name.as_deref() {
        Some(ref_spec) if !ref_spec.trim().is_empty() => {
            read_file_content_at_ref(&root, &file_path, ref_spec.trim())
        }
        _ => read_file_content(&root, &file_path),
    }
}

fn write_file_content(
    root: &Path,
    file_path: &str,
    base_content: &str,
    content: &str,
) -> Result<SaveFileResponse, String> {
    let (normalized, canonical) = resolve_existing_repo_file(root, file_path)?;
    let metadata = fs::metadata(&canonical)
        .map_err(|error| format!("Failed to read file metadata: {error}"))?;
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err("File is too large to edit".to_string());
    }

    let current_bytes =
        fs::read(&canonical).map_err(|error| format!("Failed to read current file: {error}"))?;
    if current_bytes.contains(&0) {
        return Err("Binary files cannot be edited".to_string());
    }

    let current_content = String::from_utf8_lossy(&current_bytes).to_string();
    if current_content != base_content {
        return Ok(SaveFileResponse {
            status: "conflict".to_string(),
            file: None,
            conflict: Some(SaveConflict {
                path: normalized,
                base_content: base_content.to_string(),
                current_content,
                proposed_content: content.to_string(),
            }),
        });
    }

    let parent = canonical
        .parent()
        .ok_or_else(|| "Selected file has no parent directory".to_string())?;
    let temp_path = parent.join(format!(
        ".{}.view-save-tmp",
        canonical
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("file")
    ));
    fs::write(&temp_path, content.as_bytes())
        .map_err(|error| format!("Failed to write temporary file: {error}"))?;
    fs::rename(&temp_path, &canonical)
        .map_err(|error| format!("Failed to replace file: {error}"))?;

    Ok(SaveFileResponse {
        status: "saved".to_string(),
        file: Some(FileContent {
            path: normalized,
            content: content.to_string(),
            binary: false,
            too_large: false,
            media_type: None,
            media_data_url: None,
        }),
        conflict: None,
    })
}

fn media_type_for_path(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    match extension.as_str() {
        "avif" => Some("image/avif"),
        "bmp" => Some("image/bmp"),
        "gif" => Some("image/gif"),
        "ico" => Some("image/x-icon"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "svg" => Some("image/svg+xml"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

fn media_data_url(media_type: &str, bytes: &[u8]) -> String {
    format!(
        "data:{media_type};base64,{}",
        general_purpose::STANDARD.encode(bytes)
    )
}

impl From<EditorTextMatchRange> for EditorTextMatch {
    fn from(value: EditorTextMatchRange) -> Self {
        Self {
            start: value.start_utf16,
            end: value.end_utf16,
            line_number: value.line_number,
            line_text: value.line_text,
        }
    }
}

fn replace_editor_content(
    content: &str,
    query: &str,
    replacement: &str,
    active_index: usize,
    replace_all: bool,
) -> EditorReplaceResponse {
    let matches = editor_text_matches(content, query);
    if matches.is_empty() {
        return EditorReplaceResponse {
            content: content.to_string(),
            matches: Vec::new(),
            selection_start: 0,
            selection_end: 0,
        };
    }

    let (next_content, selection_start, selection_end) = if replace_all {
        let mut next_content = String::with_capacity(content.len());
        let mut cursor = 0;
        for text_match in &matches {
            next_content.push_str(&content[cursor..text_match.start_byte]);
            next_content.push_str(replacement);
            cursor = text_match.end_byte;
        }
        next_content.push_str(&content[cursor..]);
        (next_content, 0, 0)
    } else {
        let text_match = &matches[active_index.min(matches.len() - 1)];
        let mut next_content = String::with_capacity(
            content.len()
                + replacement
                    .len()
                    .saturating_sub(text_match.end_byte - text_match.start_byte),
        );
        next_content.push_str(&content[..text_match.start_byte]);
        next_content.push_str(replacement);
        next_content.push_str(&content[text_match.end_byte..]);

        let selection_start = utf16_offset_at(content, text_match.start_byte);
        let selection_end = selection_start + replacement.encode_utf16().count();
        (next_content, selection_start, selection_end)
    };

    let next_matches = editor_text_matches(&next_content, query)
        .into_iter()
        .map(EditorTextMatch::from)
        .collect();

    EditorReplaceResponse {
        content: next_content,
        matches: next_matches,
        selection_start,
        selection_end,
    }
}

fn editor_text_matches(content: &str, query: &str) -> Vec<EditorTextMatchRange> {
    let trimmed_query = query.trim();
    if trimmed_query.is_empty() {
        return Vec::new();
    }

    let (haystack, haystack_indices) = lowercase_with_byte_indices(content);
    let needle = trimmed_query.to_lowercase();
    let mut matches = Vec::new();
    let mut search_from = 0;

    while let Some(relative_start) = haystack[search_from..].find(&needle) {
        let lower_start = search_from + relative_start;
        let lower_end = lower_start + needle.len();
        let Some(&start_byte) = haystack_indices.get(lower_start) else {
            break;
        };
        let mut end_byte = haystack_indices
            .get(lower_end)
            .copied()
            .unwrap_or(content.len());
        if end_byte == start_byte {
            if let Some(character) = content[start_byte..].chars().next() {
                end_byte = start_byte + character.len_utf8();
            }
        }
        if end_byte > start_byte {
            let (line_number, line_text) = line_for_byte_range(content, start_byte);
            matches.push(EditorTextMatchRange {
                start_byte,
                end_byte,
                start_utf16: utf16_offset_at(content, start_byte),
                end_utf16: utf16_offset_at(content, end_byte),
                line_number,
                line_text,
            });
        }
        search_from = lower_start + needle.len().max(1);
    }

    matches
}

fn lowercase_with_byte_indices(content: &str) -> (String, Vec<usize>) {
    let mut lowered = String::with_capacity(content.len());
    let mut indices = Vec::with_capacity(content.len());

    for (byte_index, character) in content.char_indices() {
        for lowered_character in character.to_lowercase() {
            lowered.push(lowered_character);
            for _ in 0..lowered_character.len_utf8() {
                indices.push(byte_index);
            }
        }
    }

    (lowered, indices)
}

fn utf16_offset_at(content: &str, byte_index: usize) -> usize {
    content[..byte_index].encode_utf16().count()
}

fn line_for_byte_range(content: &str, start_byte: usize) -> (usize, String) {
    let line_number = content[..start_byte]
        .bytes()
        .filter(|byte| *byte == b'\n')
        .count()
        + 1;
    let line_start = content[..start_byte]
        .rfind('\n')
        .map(|index| index + 1)
        .unwrap_or(0);
    let line_end = content[start_byte..]
        .find('\n')
        .map(|index| start_byte + index)
        .unwrap_or(content.len());
    (
        line_number,
        content[line_start..line_end]
            .trim_end_matches('\r')
            .to_string(),
    )
}

fn resolve_terminal_cwd(root: &Path, cwd: Option<&str>) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve repository root: {error}"))?;
    let candidate = cwd
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| root.clone());
    let full_path = if candidate.is_absolute() {
        candidate
    } else {
        root.join(candidate)
    };
    let canonical = full_path
        .canonicalize()
        .map_err(|error| format!("Failed to resolve terminal cwd: {error}"))?;
    if !canonical.starts_with(&root) {
        return Err("Terminal cwd must stay inside the repository".to_string());
    }
    if !canonical.is_dir() {
        return Err("Terminal cwd is not a directory".to_string());
    }
    Ok(canonical)
}

fn terminal_named_color(color: NamedColor) -> Option<&'static str> {
    match color {
        NamedColor::Black => Some("#1f2933"),
        NamedColor::Red => Some("#ef6f6c"),
        NamedColor::Green => Some("#6dd58c"),
        NamedColor::Yellow => Some("#d9b45f"),
        NamedColor::Blue => Some("#72a7ff"),
        NamedColor::Magenta => Some("#d783d7"),
        NamedColor::Cyan => Some("#65cfd3"),
        NamedColor::White => Some("#d7dde2"),
        NamedColor::BrightBlack => Some("#6b7480"),
        NamedColor::BrightRed => Some("#ff8f87"),
        NamedColor::BrightGreen => Some("#88e0a1"),
        NamedColor::BrightYellow => Some("#edcc75"),
        NamedColor::BrightBlue => Some("#90bbff"),
        NamedColor::BrightMagenta => Some("#ec9dea"),
        NamedColor::BrightCyan => Some("#84e4e7"),
        NamedColor::BrightWhite => Some("#f7fafc"),
        NamedColor::DimBlack => Some("#111827"),
        NamedColor::DimRed => Some("#9f4a48"),
        NamedColor::DimGreen => Some("#4f9b66"),
        NamedColor::DimYellow => Some("#9d8247"),
        NamedColor::DimBlue => Some("#547db8"),
        NamedColor::DimMagenta => Some("#9b619b"),
        NamedColor::DimCyan => Some("#4b989b"),
        NamedColor::DimWhite => Some("#9ca3af"),
        NamedColor::BrightForeground => Some("#f7fafc"),
        NamedColor::DimForeground => Some("#9ca3af"),
        NamedColor::Foreground | NamedColor::Background | NamedColor::Cursor => None,
    }
}

fn terminal_indexed_color(value: u8) -> String {
    const BASIC: [&str; 16] = [
        "#1f2933", "#ef6f6c", "#6dd58c", "#d9b45f", "#72a7ff", "#d783d7", "#65cfd3", "#d7dde2",
        "#6b7480", "#ff8f87", "#88e0a1", "#edcc75", "#90bbff", "#ec9dea", "#84e4e7", "#f7fafc",
    ];
    if let Some(color) = BASIC.get(value as usize) {
        return (*color).to_string();
    }
    if (16..=231).contains(&value) {
        let offset = value - 16;
        let red = offset / 36;
        let green = (offset % 36) / 6;
        let blue = offset % 6;
        let component = |part: u8| if part == 0 { 0 } else { 55 + part * 40 };
        return format!(
            "rgb({} {} {})",
            component(red),
            component(green),
            component(blue)
        );
    }
    let gray = 8 + value.saturating_sub(232) * 10;
    format!("rgb({gray} {gray} {gray})")
}

fn terminal_color(color: TerminalColorValue) -> Option<String> {
    match color {
        TerminalColorValue::Named(color) => terminal_named_color(color).map(str::to_string),
        TerminalColorValue::Indexed(value) => Some(terminal_indexed_color(value)),
        TerminalColorValue::Spec(rgb) => Some(format!("rgb({} {} {})", rgb.r, rgb.g, rgb.b)),
    }
}

fn terminal_cell_style(cell: &Cell) -> TerminalRunStyle {
    let flags = cell.flags;
    TerminalRunStyle {
        fg: terminal_color(cell.fg),
        bg: terminal_color(cell.bg),
        bold: flags.contains(Flags::BOLD),
        dim: flags.contains(Flags::DIM),
        italic: flags.contains(Flags::ITALIC),
        underline: flags.intersects(Flags::ALL_UNDERLINES),
        inverse: flags.contains(Flags::INVERSE),
    }
}

fn terminal_frame_modes(mode: TermMode) -> TerminalFrameModes {
    TerminalFrameModes {
        app_cursor: mode.contains(TermMode::APP_CURSOR),
        app_keypad: mode.contains(TermMode::APP_KEYPAD),
        bracketed_paste: mode.contains(TermMode::BRACKETED_PASTE),
        focus_in_out: mode.contains(TermMode::FOCUS_IN_OUT),
        mouse_report_click: mode.contains(TermMode::MOUSE_REPORT_CLICK),
        mouse_drag: mode.contains(TermMode::MOUSE_DRAG),
        mouse_motion: mode.contains(TermMode::MOUSE_MOTION),
        sgr_mouse: mode.contains(TermMode::SGR_MOUSE),
        utf8_mouse: mode.contains(TermMode::UTF8_MOUSE),
        alt_screen: mode.contains(TermMode::ALT_SCREEN),
    }
}

fn terminal_frame(term: &Term<TerminalEventProxy>, title: Option<&str>) -> Result<String, String> {
    let grid = term.grid();
    let cols = grid.columns();
    let rows = grid.screen_lines();
    let mode = term.mode();
    let display_offset = grid.display_offset() as i32;
    let cursor = grid.cursor.point;
    let cursor_row = (cursor.line.0 + display_offset).max(0) as usize;
    let cursor_col = cursor.column.0.min(cols.saturating_sub(1));
    let cursor_visible =
        mode.contains(TermMode::SHOW_CURSOR) && cursor_row < rows && cursor_col < cols;
    let default_style = TerminalRunStyle {
        fg: None,
        bg: None,
        bold: false,
        dim: false,
        italic: false,
        underline: false,
        inverse: false,
    };
    let mut lines = Vec::with_capacity(rows);

    for row in 0..rows {
        let line_index = Line(row as i32 - display_offset);
        let mut styled_cells = Vec::new();
        let mut current_text = String::new();
        let mut current_style = default_style.clone();
        let mut last_content_col = 0usize;

        for col in 0..cols {
            let cell = &grid[line_index][Column(col)];
            let style = terminal_cell_style(cell);
            let is_cursor = cursor_visible && row == cursor_row && col == cursor_col;
            if !cell.flags.contains(Flags::WIDE_CHAR_SPACER)
                && (cell.c != ' ' || style != default_style || is_cursor)
            {
                last_content_col = col;
            }
        }

        let render_cols = if cursor_visible && row == cursor_row {
            last_content_col.max(cursor_col) + 1
        } else {
            last_content_col + 1
        };

        for col in 0..render_cols.min(cols) {
            let cell = &grid[line_index][Column(col)];
            let style = terminal_cell_style(cell);
            if col == 0 {
                current_style = style.clone();
            } else if style != current_style {
                styled_cells.push(TerminalFrameRun {
                    text: std::mem::take(&mut current_text),
                    style: current_style,
                });
                current_style = style.clone();
            }

            let character = if cell.flags.contains(Flags::WIDE_CHAR_SPACER) {
                ' '
            } else if cell.flags.contains(Flags::HIDDEN) {
                ' '
            } else {
                cell.c
            };
            current_text.push(character);
            if let Some(zerowidth) = cell.zerowidth() {
                current_text.extend(zerowidth);
            }
        }

        styled_cells.push(TerminalFrameRun {
            text: current_text,
            style: current_style,
        });
        lines.push(TerminalFrameLine {
            cells: styled_cells,
        });
    }

    serde_json::to_string(&TerminalFrame {
        message_type: "frame",
        title: title.map(str::to_string),
        rows,
        cols,
        cursor_row,
        cursor_col,
        cursor_visible,
        modes: terminal_frame_modes(*mode),
        lines,
    })
    .map_err(|error| format!("Failed to serialize terminal frame: {error}"))
}

fn drain_terminal_ui_events(
    ui_event_rx: &mpsc::Receiver<TerminalUiEvent>,
    title: &mut Option<String>,
) {
    while let Ok(event) = ui_event_rx.try_recv() {
        match event {
            TerminalUiEvent::Title(next_title) => {
                *title = next_title;
            }
        }
    }
}

fn spawn_terminal_session(
    state: &TerminalState,
    root: &Path,
    cwd: Option<&str>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<TerminalSessionInfo, String> {
    let cwd = resolve_terminal_cwd(root, cwd)?;
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.unwrap_or(24).max(1),
            cols: cols.unwrap_or(80).max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Failed to create terminal PTY: {error}"))?;
    let portable_pty::PtyPair { master, slave } = pair;
    let mut command = CommandBuilder::new_default_prog();
    command.cwd(&cwd);
    command.env("TERM", "xterm-256color");

    let mut child = slave
        .spawn_command(command)
        .map_err(|error| format!("Failed to spawn terminal shell: {error}"))?;
    let pid = child.process_id();
    let killer = child.clone_killer();
    drop(slave);

    let mut reader = master
        .try_clone_reader()
        .map_err(|error| format!("Failed to open terminal reader: {error}"))?;
    let writer = master
        .take_writer()
        .map_err(|error| format!("Failed to open terminal writer: {error}"))?;
    let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>();
    let (parser_tx, parser_rx) = mpsc::channel::<TerminalParserEvent>();
    let (ui_event_tx, ui_event_rx) = mpsc::channel::<TerminalUiEvent>();
    thread::spawn(move || {
        let mut writer = writer;
        while let Ok(input) = input_rx.recv() {
            if writer.write_all(&input).is_err() {
                break;
            }
            if writer.flush().is_err() {
                break;
            }
        }
    });

    let id = state
        .next_id
        .fetch_add(1, Ordering::Relaxed)
        .saturating_add(1)
        .to_string();
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("Failed to bind terminal WebSocket: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("Failed to configure terminal WebSocket: {error}"))?;
    let ws_port = listener
        .local_addr()
        .map_err(|error| format!("Failed to read terminal WebSocket address: {error}"))?
        .port();
    let ws_url = format!("ws://127.0.0.1:{ws_port}/terminal/{id}");
    let sessions = state.sessions.clone();
    let (ws_output_tx, ws_output_rx) = mpsc::channel::<TerminalWsEvent>();
    let (ws_shutdown_tx, ws_shutdown_rx) = mpsc::channel::<()>();
    let parser_input_tx = input_tx.clone();
    let ws_input_tx = input_tx.clone();
    {
        let mut sessions_guard = sessions.lock().map_err(|error| error.to_string())?;
        sessions_guard.insert(
            id.clone(),
            TerminalSession {
                parser_tx: parser_tx.clone(),
                ws_shutdown_tx,
                killer: Mutex::new(killer),
                master,
            },
        );
    }

    let reader_parser_tx = parser_tx.clone();
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    if reader_parser_tx
                        .send(TerminalParserEvent::Output(buffer[..read].to_vec()))
                        .is_err()
                    {
                        break;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
    });

    let reader_output_tx = ws_output_tx.clone();
    thread::spawn(move || {
        let initial_cols = cols.unwrap_or(80).max(1) as usize;
        let initial_rows = rows.unwrap_or(24).max(1) as usize;
        let mut term = Term::new(
            TerminalConfig::default(),
            &TermSize::new(initial_cols, initial_rows),
            TerminalEventProxy {
                input_tx: parser_input_tx,
                ui_event_tx,
            },
        );
        let mut processor = TerminalProcessor::<TerminalSyncHandler>::new();
        let mut title: Option<String> = None;
        if let Ok(frame) = terminal_frame(&term, title.as_deref()) {
            let _ = reader_output_tx.send(TerminalWsEvent::Frame(frame));
        }

        let apply_event =
            |event: TerminalParserEvent,
             term: &mut Term<TerminalEventProxy>,
             processor: &mut TerminalProcessor<TerminalSyncHandler>| {
                match event {
                    TerminalParserEvent::Output(bytes) => {
                        processor.advance(term, &bytes);
                    }
                    TerminalParserEvent::Resize(cols, rows) => {
                        term.resize(TermSize::new(cols.max(1) as usize, rows.max(1) as usize));
                    }
                }
            };

        while let Ok(event) = parser_rx.recv() {
            apply_event(event, &mut term, &mut processor);
            while let Ok(event) = parser_rx.try_recv() {
                apply_event(event, &mut term, &mut processor);
            }
            drain_terminal_ui_events(&ui_event_rx, &mut title);

            match terminal_frame(&term, title.as_deref()) {
                Ok(frame) => {
                    if reader_output_tx
                        .send(TerminalWsEvent::Frame(frame))
                        .is_err()
                    {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    thread::spawn(move || {
        run_terminal_ws(listener, ws_input_tx, ws_output_rx, ws_shutdown_rx);
    });

    let exit_output_tx = ws_output_tx;
    thread::spawn(move || {
        let exit_code = child.wait().ok().map(|status| status.exit_code());
        let _ = exit_output_tx.send(TerminalWsEvent::Close(exit_code));
    });

    Ok(TerminalSessionInfo {
        id,
        cwd: cwd.to_string_lossy().to_string(),
        pid,
        ws_url,
    })
}

fn run_terminal_ws(
    listener: TcpListener,
    input_tx: mpsc::Sender<Vec<u8>>,
    output_rx: mpsc::Receiver<TerminalWsEvent>,
    shutdown_rx: mpsc::Receiver<()>,
) {
    let sleep_duration = Duration::from_millis(TERMINAL_WS_IDLE_SLEEP_MS);
    let mut websocket = loop {
        if shutdown_rx.try_recv().is_ok() {
            return;
        }
        match listener.accept() {
            Ok((stream, _)) => {
                let _ = stream.set_nodelay(true);
                match accept(stream) {
                    Ok(mut websocket) => {
                        let _ = websocket.get_mut().set_nonblocking(true);
                        let _ = websocket.get_mut().set_nodelay(true);
                        break websocket;
                    }
                    Err(_) => return,
                }
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                thread::sleep(sleep_duration);
            }
            Err(_) => return,
        }
    };

    let mut pending_output = VecDeque::<TerminalWsEvent>::new();
    loop {
        if shutdown_rx.try_recv().is_ok() {
            let _ = websocket.close(None);
            return;
        }
        let mut did_work = false;

        loop {
            match websocket.read() {
                Ok(Message::Text(text)) => {
                    did_work = true;
                    let _ = input_tx.send(text.into_bytes());
                }
                Ok(Message::Binary(bytes)) => {
                    did_work = true;
                    let _ = input_tx.send(bytes);
                }
                Ok(Message::Close(_)) => return,
                Ok(Message::Ping(payload)) => {
                    did_work = true;
                    let _ = websocket.send(Message::Pong(payload));
                }
                Ok(Message::Pong(_)) | Ok(Message::Frame(_)) => {
                    did_work = true;
                }
                Err(WsError::Io(error)) if error.kind() == ErrorKind::WouldBlock => break,
                Err(WsError::ConnectionClosed) | Err(WsError::AlreadyClosed) => return,
                Err(_) => return,
            }
        }

        while let Ok(event) = output_rx.try_recv() {
            did_work = true;
            pending_output.push_back(event);
            while pending_output.len() > TERMINAL_WS_PENDING_OUTPUT_LIMIT {
                pending_output.pop_front();
            }
        }

        let mut sent_output_count = 0;
        while sent_output_count < TERMINAL_WS_OUTPUT_BURST_LIMIT {
            let Some(event) = pending_output.pop_front() else {
                break;
            };
            match write_terminal_ws_event(&mut websocket, &event) {
                Ok(true) => return,
                Ok(false) => {
                    did_work = true;
                    sent_output_count += 1;
                }
                Err(WsError::Io(error)) if error.kind() == ErrorKind::WouldBlock => {
                    pending_output.push_front(event);
                    break;
                }
                Err(WsError::ConnectionClosed) | Err(WsError::AlreadyClosed) => return,
                Err(_) => return,
            }
        }

        if !did_work {
            thread::sleep(sleep_duration);
        }
    }
}

fn write_terminal_ws_event(
    websocket: &mut WebSocket<TcpStream>,
    event: &TerminalWsEvent,
) -> Result<bool, WsError> {
    match event {
        TerminalWsEvent::Frame(frame) => {
            websocket.send(Message::Text(frame.clone()))?;
            Ok(false)
        }
        TerminalWsEvent::Close(exit_code) => {
            let message = match exit_code {
                Some(code) => format!(r#"{{"type":"close","exitCode":{code}}}"#),
                None => r#"{"type":"close","exitCode":null}"#.to_string(),
            };
            websocket.send(Message::Text(message))?;
            let _ = websocket.close(None);
            Ok(true)
        }
    }
}

#[allow(dead_code)]
fn search_project_files(
    root: &Path,
    query: &str,
    limit: Option<usize>,
) -> Result<Vec<FileSearchResult>, String> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let limit = limit
        .unwrap_or(DEFAULT_FILE_SEARCH_LIMIT)
        .clamp(1, MAX_FILE_SEARCH_LIMIT);
    let shared_picker = SharedFilePicker::default();
    let shared_frecency = SharedFrecency::default();

    FilePicker::new_with_shared_state(
        shared_picker.clone(),
        shared_frecency,
        FilePickerOptions {
            base_path: root.to_string_lossy().to_string(),
            mode: FFFMode::Ai,
            watch: false,
            ..Default::default()
        },
    )
    .map_err(|error| error.to_string())?;

    if !shared_picker.wait_for_scan(FILE_SEARCH_SCAN_TIMEOUT) {
        return Err("Timed out while indexing files for search".to_string());
    }

    let parsed_query = QueryParser::default().parse(query);
    let grep_query = QueryParser::new(GrepConfig).parse(query);
    let picker_guard = shared_picker.read().map_err(|error| error.to_string())?;
    let picker = picker_guard
        .as_ref()
        .ok_or_else(|| "File search index was not initialized".to_string())?;
    let file_results = picker.fuzzy_search(
        &parsed_query,
        None,
        FuzzySearchOptions {
            max_threads: 0,
            current_file: None,
            project_path: Some(root),
            pagination: PaginationArgs { offset: 0, limit },
            ..Default::default()
        },
    );
    let grep_results = picker.grep(
        &grep_query,
        &GrepSearchOptions {
            max_matches_per_file: 1,
            page_limit: limit,
            mode: GrepMode::PlainText,
            time_budget_ms: 400,
            trim_whitespace: true,
            ..Default::default()
        },
    );
    let mut grep_matches_by_path: HashMap<String, (usize, String, i32)> = HashMap::new();
    for matched in &grep_results.matches {
        let Some(file) = grep_results.files.get(matched.file_index) else {
            continue;
        };
        let path = file.relative_path(picker).replace('\\', "/");
        grep_matches_by_path.entry(path).or_insert_with(|| {
            (
                matched.line_number as usize,
                matched.line_content.clone(),
                matched.fuzzy_score.map(i32::from).unwrap_or(0),
            )
        });
    }

    let mut combined = file_results
        .items
        .iter()
        .zip(file_results.scores.iter())
        .map(|(item, score)| FileSearchResult {
            path: item.relative_path(picker).replace('\\', "/"),
            score: score.total,
            line_number: None,
            line_text: None,
            context_before: Vec::new(),
            context_after: Vec::new(),
            match_ranges: Vec::new(),
        })
        .map(|mut result| {
            if let Some((line_number, line_text, _)) = grep_matches_by_path.get(&result.path) {
                result.line_number = Some(*line_number);
                result.line_text = Some(line_text.clone());
            }
            result
        })
        .fold(Vec::<FileSearchResult>::new(), |mut results, result| {
            if results.iter().all(|current| current.path != result.path) {
                results.push(result);
            }
            results
        });

    for matched in &grep_results.matches {
        let Some(file) = grep_results.files.get(matched.file_index) else {
            continue;
        };
        let path = file.relative_path(picker).replace('\\', "/");
        if combined.iter().any(|result| result.path == path) {
            continue;
        }
        combined.push(FileSearchResult {
            path,
            score: matched.fuzzy_score.map(i32::from).unwrap_or(0),
            line_number: Some(matched.line_number as usize),
            line_text: Some(matched.line_content.clone()),
            context_before: Vec::new(),
            context_after: Vec::new(),
            match_ranges: Vec::new(),
        });
        if combined.len() >= limit {
            break;
        }
    }

    combined.truncate(limit);
    Ok(combined)
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
    let pathspecs = git_pathspec::validate_existing_pathspecs(root, &[file_path.to_string()])?;
    let file_path = pathspecs
        .first()
        .ok_or_else(|| "File path is required".to_string())?;
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
    let Ok(pathspecs) = git_pathspec::validate_existing_pathspecs(root, &[file_path.to_string()])
    else {
        return false;
    };
    let args = git_pathspec::git_args_with_pathspecs(
        &["ls-files", "--others", "--exclude-standard"],
        &pathspecs,
    );
    let output = git_owned(root, &args).unwrap_or_default();
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
    git_with_env(root, args, &[])
}

fn git_with_env(root: &Path, args: &[&str], envs: &[(&str, &str)]) -> Result<String, String> {
    let mut command = Command::new("git");
    command
        .arg("-c")
        .arg("core.quotepath=false")
        .arg("-C")
        .arg(root)
        .args(args);
    for (key, value) in envs {
        command.env(*key, *value);
    }

    let output = command
        .output()
        .map_err(|error| format!("Failed to run git: {error}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(stderr_or_status("git command failed", output.stderr))
    }
}

fn git_with_env_stdout_on_error(
    root: &Path,
    args: &[&str],
    envs: &[(&str, &str)],
) -> Result<String, String> {
    let mut command = Command::new("git");
    command
        .arg("-c")
        .arg("core.quotepath=false")
        .arg("-C")
        .arg(root)
        .args(args);
    for (key, value) in envs {
        command.env(*key, *value);
    }

    let output = command
        .output()
        .map_err(|error| format!("Failed to run git: {error}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(stdout_stderr_or_status(
            "git command failed",
            &output.stdout,
            &output.stderr,
        ))
    }
}

fn git_owned(root: &Path, args: &[String]) -> Result<String, String> {
    let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    git(root, &arg_refs)
}

fn git_allow_exit(root: &Path, args: &[&str], allowed_codes: &[i32]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-c")
        .arg("core.quotepath=false")
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

fn stdout_stderr_or_status(prefix: &str, stdout: &[u8], stderr: &[u8]) -> String {
    let stdout_message = String::from_utf8_lossy(stdout).trim().to_string();
    let stderr_message = String::from_utf8_lossy(stderr).trim().to_string();
    match (stderr_message.is_empty(), stdout_message.is_empty()) {
        (true, true) => prefix.to_string(),
        (true, false) => stdout_message,
        (false, true) => stderr_message,
        (false, false) => format!("{stderr_message}\n{stdout_message}"),
    }
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
    use std::time::{Instant, SystemTime, UNIX_EPOCH};

    #[test]
    fn terminal_frame_uses_alacritty_alternate_screen_and_cursor_positioning() {
        let (input_tx, _input_rx) = mpsc::channel::<Vec<u8>>();
        let mut term = Term::new(
            TerminalConfig::default(),
            &TermSize::new(20, 6),
            test_terminal_event_proxy(input_tx),
        );
        let mut processor = TerminalProcessor::<TerminalSyncHandler>::new();

        processor.advance(
            &mut term,
            b"PRIMARY\x1b[?1049h\x1b[2J\x1b[3;5HHELLO\x1b[4;8H>",
        );

        let frame: serde_json::Value =
            serde_json::from_str(&terminal_frame(&term, None).expect("terminal frame"))
                .expect("frame json");
        assert_eq!(frame["type"], "frame");
        assert_eq!(frame["rows"], 6);
        assert_eq!(frame["cols"], 20);

        let all_text = terminal_frame_text(&frame);
        assert!(
            all_text.contains("HELLO"),
            "absolute-positioned alternate-screen content should render"
        );
        assert!(
            all_text.contains(">"),
            "cursor-positioned prompt content should render"
        );
        assert!(
            !all_text.contains("PRIMARY"),
            "alternate screen should not leak primary screen content"
        );
    }

    #[test]
    fn terminal_frame_exposes_interactive_terminal_modes() {
        let (input_tx, _input_rx) = mpsc::channel::<Vec<u8>>();
        let mut term = Term::new(
            TerminalConfig::default(),
            &TermSize::new(20, 6),
            test_terminal_event_proxy(input_tx),
        );
        let mut processor = TerminalProcessor::<TerminalSyncHandler>::new();

        processor.advance(
            &mut term,
            b"\x1b[?1h\x1b[?2004h\x1b[?1004h\x1b[?1002h\x1b[?1006h",
        );

        let frame: serde_json::Value =
            serde_json::from_str(&terminal_frame(&term, None).expect("terminal frame"))
                .expect("frame json");
        assert_eq!(frame["modes"]["appCursor"], true);
        assert_eq!(frame["modes"]["bracketedPaste"], true);
        assert_eq!(frame["modes"]["focusInOut"], true);
        assert_eq!(frame["modes"]["mouseDrag"], true);
        assert_eq!(frame["modes"]["sgrMouse"], true);
    }

    #[test]
    fn terminal_event_proxy_writes_alacritty_terminal_responses_to_pty() {
        let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>();
        let mut term = Term::new(
            TerminalConfig::default(),
            &TermSize::new(20, 6),
            test_terminal_event_proxy(input_tx),
        );
        let mut processor = TerminalProcessor::<TerminalSyncHandler>::new();

        processor.advance(&mut term, b"\x1b[3;5H\x1b[6n");

        let response = input_rx
            .recv_timeout(Duration::from_millis(200))
            .expect("terminal cursor position response");
        let response = String::from_utf8(response).expect("utf8 terminal response");
        assert_eq!(
            response, "\x1b[3;5R",
            "interactive programs rely on terminal query responses being written back to the PTY"
        );
    }

    #[test]
    fn terminal_frame_exposes_legacy_mouse_modes() {
        let (input_tx, _input_rx) = mpsc::channel::<Vec<u8>>();
        let mut term = Term::new(
            TerminalConfig::default(),
            &TermSize::new(20, 6),
            test_terminal_event_proxy(input_tx),
        );
        let mut processor = TerminalProcessor::<TerminalSyncHandler>::new();

        processor.advance(&mut term, b"\x1b[?1000h\x1b[?1005h");

        let frame: serde_json::Value =
            serde_json::from_str(&terminal_frame(&term, None).expect("terminal frame"))
                .expect("frame json");
        assert_eq!(frame["modes"]["mouseReportClick"], true);
        assert_eq!(frame["modes"]["utf8Mouse"], true);
        assert_eq!(frame["modes"]["sgrMouse"], false);
    }

    #[test]
    fn terminal_frame_exposes_title_protocol() {
        let (input_tx, _input_rx) = mpsc::channel::<Vec<u8>>();
        let (ui_event_tx, ui_event_rx) = mpsc::channel::<TerminalUiEvent>();
        let mut term = Term::new(
            TerminalConfig::default(),
            &TermSize::new(20, 6),
            TerminalEventProxy {
                input_tx,
                ui_event_tx,
            },
        );
        let mut processor = TerminalProcessor::<TerminalSyncHandler>::new();
        let mut title = None;

        processor.advance(&mut term, b"\x1b]0;View Title Protocol\x07");
        drain_terminal_ui_events(&ui_event_rx, &mut title);
        let frame: serde_json::Value =
            serde_json::from_str(&terminal_frame(&term, title.as_deref()).expect("terminal frame"))
                .expect("frame json");

        assert_eq!(frame["title"], "View Title Protocol");
    }

    #[test]
    fn terminal_session_runs_shell_command_through_websocket() {
        let repo = create_basic_repo();
        let state = TerminalState::default();
        let session = spawn_terminal_session(&state, &repo, None, Some(80), Some(12))
            .expect("spawn terminal session");
        let mut websocket = connect_terminal_websocket(&session);

        websocket
            .send(Message::Text(
                "printf '\\nVIEW_TERMINAL_E2E_OK\\n'\r".to_string(),
            ))
            .expect("send terminal input");
        let frame_text = read_terminal_until_text(&mut websocket, "VIEW_TERMINAL_E2E_OK");

        assert!(frame_text.contains("VIEW_TERMINAL_E2E_OK"));
        let _ = websocket.close(None);
        let _ = kill_terminal_session(&state, &session.id);
        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn terminal_session_accepts_bursty_websocket_input_chunks() {
        let repo = create_basic_repo();
        let state = TerminalState::default();
        let session = spawn_terminal_session(&state, &repo, None, Some(80), Some(12))
            .expect("spawn terminal session");
        let mut websocket = connect_terminal_websocket(&session);

        for chunk in [
            "printf '\\n'; ",
            "read -r VIEW_TERMINAL_VALUE; ",
            "printf 'VIEW_TERMINAL_BURST_%s\\n' \"$VIEW_TERMINAL_VALUE\"",
            "\r",
            "OK",
            "\r",
        ] {
            websocket
                .send(Message::Text(chunk.to_string()))
                .expect("send terminal input chunk");
        }

        let frame_text = read_terminal_until_text(&mut websocket, "VIEW_TERMINAL_BURST_OK");
        assert!(frame_text.contains("VIEW_TERMINAL_BURST_OK"));
        let _ = websocket.close(None);
        let _ = kill_terminal_session(&state, &session.id);
        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn terminal_sessions_keep_websocket_output_isolated() {
        let repo = create_basic_repo();
        let state = TerminalState::default();
        let session_a = spawn_terminal_session(&state, &repo, None, Some(80), Some(12))
            .expect("spawn terminal session a");
        let session_b = spawn_terminal_session(&state, &repo, None, Some(80), Some(12))
            .expect("spawn terminal session b");
        assert_ne!(session_a.id, session_b.id);
        assert_ne!(session_a.ws_url, session_b.ws_url);

        let mut websocket_a = connect_terminal_websocket(&session_a);
        let mut websocket_b = connect_terminal_websocket(&session_b);

        websocket_a
            .send(Message::Text(
                "printf '\\nVIEW_TERMINAL_SESSION_A\\n'\r".to_string(),
            ))
            .expect("send terminal a input");
        let frame_a = read_terminal_until_text(&mut websocket_a, "VIEW_TERMINAL_SESSION_A");
        assert!(frame_a.contains("VIEW_TERMINAL_SESSION_A"));
        assert!(!frame_a.contains("VIEW_TERMINAL_SESSION_B"));

        websocket_b
            .send(Message::Text(
                "printf '\\nVIEW_TERMINAL_SESSION_B\\n'\r".to_string(),
            ))
            .expect("send terminal b input");
        let frame_b = read_terminal_until_text(&mut websocket_b, "VIEW_TERMINAL_SESSION_B");
        assert!(frame_b.contains("VIEW_TERMINAL_SESSION_B"));
        assert!(!frame_b.contains("VIEW_TERMINAL_SESSION_A"));

        assert_eq!(
            state.sessions.lock().expect("terminal sessions").len(),
            2,
            "both terminal sessions should stay registered until killed"
        );

        let _ = websocket_a.close(None);
        let _ = websocket_b.close(None);
        let _ = kill_terminal_session(&state, &session_a.id);
        let _ = kill_terminal_session(&state, &session_b.id);
        assert_eq!(
            state.sessions.lock().expect("terminal sessions").len(),
            0,
            "killing both terminal sessions should clear the registry"
        );
        fs::remove_dir_all(repo).ok();
    }

    fn test_terminal_event_proxy(input_tx: mpsc::Sender<Vec<u8>>) -> TerminalEventProxy {
        let (ui_event_tx, _ui_event_rx) = mpsc::channel::<TerminalUiEvent>();
        TerminalEventProxy {
            input_tx,
            ui_event_tx,
        }
    }

    fn connect_terminal_websocket(
        session: &TerminalSessionInfo,
    ) -> WebSocket<tungstenite::stream::MaybeTlsStream<TcpStream>> {
        let (mut websocket, _) =
            tungstenite::connect(session.ws_url.as_str()).expect("connect terminal websocket");
        if let tungstenite::stream::MaybeTlsStream::Plain(stream) = websocket.get_mut() {
            stream
                .set_read_timeout(Some(Duration::from_millis(200)))
                .expect("set read timeout");
        }
        websocket
    }

    fn read_terminal_until_text(
        websocket: &mut WebSocket<tungstenite::stream::MaybeTlsStream<TcpStream>>,
        expected_text: &str,
    ) -> String {
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut last_frame_text = String::new();
        while Instant::now() < deadline {
            match websocket.read() {
                Ok(Message::Text(text)) => {
                    let Ok(frame) = serde_json::from_str::<serde_json::Value>(&text) else {
                        continue;
                    };
                    if frame["type"] != "frame" {
                        continue;
                    }
                    last_frame_text = terminal_frame_text(&frame);
                    if last_frame_text.contains(expected_text) {
                        return last_frame_text;
                    }
                }
                Ok(Message::Binary(_)) | Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {}
                Ok(Message::Close(_)) => break,
                Ok(Message::Frame(_)) => {}
                Err(WsError::Io(error))
                    if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
                Err(error) => panic!("terminal websocket read failed: {error}"),
            }
        }

        panic!(
            "terminal output {expected_text:?} was not rendered; last frame: {last_frame_text:?}"
        );
    }

    fn terminal_frame_text(frame: &serde_json::Value) -> String {
        frame["lines"]
            .as_array()
            .expect("frame lines")
            .iter()
            .flat_map(|line| {
                line["cells"]
                    .as_array()
                    .expect("line cells")
                    .iter()
                    .filter_map(|cell| cell["text"].as_str())
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

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
    fn project_files_include_tracked_and_untracked_files() {
        let repo = create_basic_repo();
        fs::create_dir_all(repo.join("src")).expect("create src");
        fs::write(repo.join("src").join("main.rs"), "fn main() {}\n").expect("write tracked");
        run_git(&repo, &["add", "."]);
        run_git(&repo, &["commit", "-m", "tracked"]);
        fs::write(repo.join("draft.txt"), "draft\n").expect("write untracked");
        fs::create_dir_all(repo.join("附件")).expect("create unicode directory");
        fs::write(repo.join("附件").join("截图.png"), "image\n").expect("write unicode path");

        let files = git_files(&repo).expect("project files");
        assert!(
            files
                .iter()
                .any(|file| file.path == "src/main.rs" && file.status.is_none()),
            "tracked files should appear in the project tree"
        );
        assert!(
            files.iter().any(|file| file.path == "draft.txt"
                && file.status.as_deref() == Some("untracked")),
            "untracked files should appear in the project tree"
        );
        assert!(
            files
                .iter()
                .any(|file| file.path == "附件/截图.png"
                    && file.status.as_deref() == Some("untracked")),
            "unicode paths should not be returned as git quote escapes"
        );

        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn create_repo_file_accepts_repo_root_shortcut_and_creates_parents() {
        let repo = create_basic_repo();

        let created = create_repo_file(&repo, "/aaa/bbb/cc/asd.txt").expect("create nested file");

        assert_eq!(created, "aaa/bbb/cc/asd.txt");
        assert!(
            repo.join("aaa")
                .join("bbb")
                .join("cc")
                .join("asd.txt")
                .is_file(),
            "leading slash should mean repository root, not filesystem root"
        );

        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn create_repo_file_normalizes_backslashes_without_stripping_folder_names() {
        let repo = create_basic_repo();

        let created = create_repo_file(&repo, "a\\bbb.txt").expect("create windows-style path");

        assert_eq!(created, "a/bbb.txt");
        assert!(repo.join("a").join("bbb.txt").is_file());

        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn create_repo_file_rejects_paths_that_are_not_cross_platform() {
        let repo = create_basic_repo();

        for path in [
            "../outside.txt",
            "C:/outside.txt",
            "bad:name.txt",
            "bad?.txt",
            "name-with-dot./file.txt",
            "CON",
            "aux.txt",
        ] {
            assert!(
                create_repo_file(&repo, path).is_err(),
                "{path:?} should be rejected"
            );
        }

        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn rename_repo_file_moves_files_when_destination_parent_exists() {
        let repo = create_basic_repo();
        fs::create_dir_all(repo.join("src")).expect("create src");
        fs::write(repo.join("old.txt"), "old\n").expect("write old file");

        let renamed =
            rename_repo_file(&repo, "old.txt", "src/new.txt").expect("rename project file");

        assert_eq!(renamed, "src/new.txt");
        assert!(!repo.join("old.txt").exists());
        assert_eq!(
            fs::read_to_string(repo.join("src").join("new.txt")).expect("read renamed file"),
            "old\n"
        );

        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn rename_repo_file_rejects_missing_parent_and_existing_destination() {
        let repo = create_basic_repo();
        fs::write(repo.join("old.txt"), "old\n").expect("write old file");
        fs::write(repo.join("exists.txt"), "exists\n").expect("write existing file");

        assert!(
            rename_repo_file(&repo, "old.txt", "missing/new.txt").is_err(),
            "rename should not recursively create destination directories"
        );
        assert!(
            rename_repo_file(&repo, "old.txt", "exists.txt").is_err(),
            "rename should not overwrite an existing destination"
        );

        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn delete_repo_file_removes_files_but_rejects_directories() {
        let repo = create_basic_repo();
        fs::create_dir_all(repo.join("dir")).expect("create dir");
        fs::write(repo.join("note.txt"), "hello\n").expect("write note");

        delete_repo_file(&repo, "note.txt").expect("delete file");

        assert!(!repo.join("note.txt").exists());
        assert!(
            delete_repo_file(&repo, "dir").is_err(),
            "directory deletion should stay disabled"
        );

        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn file_content_reads_text_and_rejects_outside_paths() {
        let repo = create_basic_repo();
        fs::write(repo.join("note.txt"), "hello\n").expect("write text");

        let content = read_file_content(&repo, "note.txt").expect("file content");
        assert_eq!(content.path, "note.txt");
        assert_eq!(content.content, "hello\n");
        assert!(!content.binary);
        assert!(!content.too_large);
        assert!(content.media_type.is_none());
        assert!(content.media_data_url.is_none());

        assert!(
            read_file_content(&repo, "../note.txt").is_err(),
            "file content should not read outside the repository"
        );

        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn file_content_renders_svg_as_text_and_media_preview() {
        let repo = create_basic_repo();
        fs::write(
            repo.join("logo.svg"),
            r#"<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>"#,
        )
        .expect("write svg");

        let content = read_file_content(&repo, "logo.svg").expect("svg content");

        assert_eq!(content.path, "logo.svg");
        assert_eq!(content.media_type.as_deref(), Some("image/svg+xml"));
        assert!(
            content
                .media_data_url
                .as_deref()
                .is_some_and(|url| url.starts_with("data:image/svg+xml;base64,")),
            "svg should include a renderable preview URL"
        );
        assert!(!content.binary);
        assert!(content.content.contains("<svg"));

        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn file_content_renders_binary_images_as_media_preview() {
        let repo = create_basic_repo();
        fs::write(
            repo.join("pixel.png"),
            [
                0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n', 0, 0, 0, 0,
            ],
        )
        .expect("write png");

        let content = read_file_content(&repo, "pixel.png").expect("png content");

        assert_eq!(content.path, "pixel.png");
        assert_eq!(content.media_type.as_deref(), Some("image/png"));
        assert!(
            content
                .media_data_url
                .as_deref()
                .is_some_and(|url| url.starts_with("data:image/png;base64,")),
            "binary image should include a renderable preview URL"
        );
        assert!(content.binary);
        assert!(content.content.is_empty());

        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn write_file_content_saves_when_base_matches_disk() {
        let repo = create_basic_repo();
        fs::write(repo.join("note.txt"), "hello\n").expect("write text");

        let response = write_file_content(&repo, "note.txt", "hello\n", "hello view\n")
            .expect("write file content");

        assert_eq!(response.status, "saved");
        assert!(response.conflict.is_none());
        assert_eq!(
            response.file.as_ref().map(|file| file.content.as_str()),
            Some("hello view\n")
        );
        assert_eq!(
            fs::read_to_string(repo.join("note.txt")).expect("read saved file"),
            "hello view\n"
        );

        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn write_file_content_reports_conflict_when_disk_changed() {
        let repo = create_basic_repo();
        fs::write(repo.join("note.txt"), "disk\n").expect("write text");

        let response =
            write_file_content(&repo, "note.txt", "base\n", "mine\n").expect("write file content");

        assert_eq!(response.status, "conflict");
        assert!(response.file.is_none());
        let conflict = response.conflict.expect("conflict payload");
        assert_eq!(conflict.path, "note.txt");
        assert_eq!(conflict.base_content, "base\n");
        assert_eq!(conflict.current_content, "disk\n");
        assert_eq!(conflict.proposed_content, "mine\n");
        assert_eq!(
            fs::read_to_string(repo.join("note.txt")).expect("read conflicted file"),
            "disk\n"
        );

        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn file_search_returns_ranked_paths_for_query() {
        let repo = create_basic_repo();
        fs::create_dir_all(repo.join("src").join("components")).expect("create components");
        fs::write(
            repo.join("src").join("App.tsx"),
            "export function App() {}\n",
        )
        .expect("write app");
        fs::write(
            repo.join("src").join("components").join("TreePanel.tsx"),
            "export function TreePanel() {}\n",
        )
        .expect("write tree panel");
        fs::write(repo.join("README.md"), "# View\n").expect("write readme");
        run_git(&repo, &["add", "."]);
        run_git(&repo, &["commit", "-m", "files"]);

        let results = search_project_files(&repo, "tree panel", Some(5)).expect("search files");
        assert!(
            results
                .iter()
                .any(|result| result.path == "src/components/TreePanel.tsx"),
            "fuzzy file search should find matching repository paths"
        );
        assert!(
            results.len() <= 5,
            "file search should respect the requested limit"
        );

        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn file_search_returns_content_matches_with_line_preview() {
        let repo = create_basic_repo();
        fs::create_dir_all(repo.join("src")).expect("create src");
        fs::write(
            repo.join("src").join("alpha.ts"),
            "const needleSymbol = true;\nexport const value = needleSymbol;\n",
        )
        .expect("write source");
        run_git(&repo, &["add", "."]);
        run_git(&repo, &["commit", "-m", "content"]);

        let results = search_project_files(&repo, "needleSymbol", Some(5)).expect("search files");
        let result = results
            .iter()
            .find(|result| result.path == "src/alpha.ts")
            .expect("content search should find matching file contents");

        assert_eq!(result.line_number, Some(1));
        assert_eq!(
            result.line_text.as_deref(),
            Some("const needleSymbol = true;")
        );

        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn file_search_empty_query_returns_no_results() {
        let repo = create_basic_repo();
        fs::write(repo.join("note.txt"), "hello\n").expect("write text");

        let results = search_project_files(&repo, "   ", Some(5)).expect("empty search");
        assert!(results.is_empty());

        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn editor_search_returns_utf16_offsets() {
        let response =
            search_editor_text("a😀 beta\n第二个 Beta\n".to_string(), "beta".to_string())
                .expect("editor search");

        assert_eq!(response.matches.len(), 2);
        assert_eq!(response.matches[0].start, 4);
        assert_eq!(response.matches[0].end, 8);
        assert_eq!(response.matches[0].line_number, 1);
        assert_eq!(response.matches[0].line_text, "a😀 beta");
        assert_eq!(response.matches[1].line_number, 2);
        assert_eq!(response.matches[1].line_text, "第二个 Beta");
    }

    #[test]
    fn editor_replace_can_replace_all_matches() {
        let response = replace_editor_text(
            "Alpha beta BETA".to_string(),
            "beta".to_string(),
            "gamma".to_string(),
            0,
            true,
        )
        .expect("editor replace");

        assert_eq!(response.content, "Alpha gamma gamma");
        assert!(response.matches.is_empty());
        assert_eq!(response.selection_start, 0);
        assert_eq!(response.selection_end, 0);
    }

    #[test]
    fn status_entries_mark_unmerged_files_as_conflicts() {
        let statuses = parse_porcelain_v1_z_status("UU src/app.ts\0 U src/lib.rs\0AA README.md\0")
            .expect("parse conflict statuses");

        assert_eq!(
            statuses
                .into_iter()
                .map(|file| (file.path, file.status.unwrap_or_default()))
                .collect::<Vec<_>>(),
            vec![
                ("README.md".to_string(), "conflict".to_string()),
                ("src/app.ts".to_string(), "conflict".to_string()),
                ("src/lib.rs".to_string(), "conflict".to_string()),
            ]
        );
    }

    #[test]
    fn pull_current_branch_rejects_unknown_mode() {
        let repo = create_basic_repo();
        fs::write(repo.join("base.txt"), "base\n").expect("write base");
        run_git(&repo, &["add", "."]);
        run_git(&repo, &["commit", "-m", "base"]);

        let error = pull_current_branch(repo.to_string_lossy().to_string(), "squash".to_string())
            .expect_err("unknown pull mode should be rejected");
        assert_eq!(error, "Pull mode must be merge or rebase");

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

    #[test]
    fn system_fonts_returns_sorted_unique_families() {
        let fonts = system_fonts();
        let mut previous_family: Option<String> = None;
        for font in fonts {
            assert!(!font.family.trim().is_empty());
            if let Some(previous) = previous_family.as_deref() {
                assert!(previous < font.family.as_str());
            }
            previous_family = Some(font.family);
        }
    }

    #[test]
    fn remote_branch_tracking_uses_matching_local_branch_when_not_current() {
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

        run_git(&clone, &["checkout", "-b", "feature"]);
        run_git(&clone, &["checkout", "main"]);

        run_git(&remote, &["checkout", "-b", "feature"]);
        fs::write(remote.join("feature.txt"), "remote feature\n").expect("write feature");
        run_git(&remote, &["add", "."]);
        run_git(&remote, &["commit", "-m", "remote feature"]);
        run_git(&clone, &["fetch", "--all", "--prune"]);

        let branches = git_branches(&clone).expect("branches");
        let remote_feature = branches
            .iter()
            .find(|branch| branch.ref_name == "refs/remotes/origin/feature")
            .expect("remote feature");
        assert_eq!(remote_feature.ahead, Some(0));
        assert_eq!(remote_feature.behind, Some(1));

        fs::remove_dir_all(remote).ok();
        fs::remove_dir_all(clone).ok();
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
        .manage(TerminalState::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Some(scale) = wsl::display_scale_factor() {
                if let Some(window) = app.get_webview_window("main") {
                    // Zoom is applied from the frontend (applyDisplayScale) after
                    // navigation, because WebKitGTK resets the webview zoom level on
                    // page load. The window size still scales here since it is
                    // independent of webview navigation.
                    let _ = window.set_size(LogicalSize::new(
                        1320.0 * scale,
                        840.0 * scale,
                    ));
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            default_start_path,
            list_system_fonts,
            load_repository,
            get_diff,
            get_file_diff,
            get_commits,
            get_project_files,
            get_file_blob,
            get_file_content,
            save_file_content,
            create_project_file,
            rename_project_file,
            delete_project_file,
            search_file_names,
            search_file_contents,
            search_editor_text,
            replace_editor_text,
            fetch_remotes,
            checkout_branch,
            create_branch,
            rename_branch,
            delete_branch,
            pull_current_branch,
            git_commit_push::create_commit,
            git_commit_push::push_current_branch,
            git_write::stage_files,
            git_write::unstage_files,
            git_restore::restore_files,
            terminal_spawn,
            terminal_resize,
            terminal_kill,
            wsl::wsl_display_scale
        ])
        .run(tauri::generate_context!())
        // SAFE-EXPECT: Tauri can only fail here during unrecoverable app bootstrap.
        .expect("error while running tauri application");
}
