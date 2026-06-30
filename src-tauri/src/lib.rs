use alacritty_terminal::event::{Event as TerminalEvent, EventListener};
use alacritty_terminal::grid::{Dimensions, Scroll};
use alacritty_terminal::index::{Column, Line};
use alacritty_terminal::term::cell::{Cell, Flags};
use alacritty_terminal::term::test::TermSize;
use alacritty_terminal::term::{Config as TerminalConfig, Term, TermMode};
use alacritty_terminal::vte::ansi::{
    Color as TerminalColorValue, CursorShape, CursorStyle, NamedColor,
};
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
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::{ErrorKind, Read, Write};
use std::net::{TcpListener, TcpStream};
#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    mpsc, Arc, Mutex,
};
use std::thread;
use std::time::Duration;
use tauri::State;
use tungstenite::{accept, Error as WsError, Message, WebSocket};
use unicode_segmentation::UnicodeSegmentation;
use unicode_width::UnicodeWidthStr;

mod clipboard_paste;
mod code_search;
mod git_commit_push;
mod git_history_ops;
#[cfg(test)]
#[path = "git_log_tracking_tests.rs"]
mod git_log_tracking_tests;
mod git_pathspec;
mod git_restore;
mod git_stash;
mod git_status;
mod git_tracking;
mod git_write;
mod run_targets;
mod wsl;

use git_status::{
    count_statuses, normalize_git_path, parse_name_status_entries, parse_porcelain_v1_z_status,
    StatusCounts, TreeFile, WORKTREE_STATUS_ARGS,
};
use git_tracking::CommitTrackingInfo;
use run_targets::FileRunTarget;

const MAX_TEXT_FILE_BYTES: u64 = 1_048_576;
const MAX_MEDIA_FILE_BYTES: u64 = 5_242_880;
const DEFAULT_FILE_SEARCH_LIMIT: usize = 50;
const MAX_FILE_SEARCH_LIMIT: usize = 200;
const FILE_SEARCH_SCAN_TIMEOUT: Duration = Duration::from_secs(10);
const TERMINAL_WS_IDLE_SLEEP_MS: u64 = 1;
const TERMINAL_WS_PENDING_OUTPUT_LIMIT: usize = 64;
const TERMINAL_WS_OUTPUT_BURST_LIMIT: usize = 8;
const TERMINAL_SESSION_METADATA_POLL_INTERVAL: Duration = Duration::from_millis(500);
const ZERO_OID: &str = "0000000000000000000000000000000000000000";

pub(crate) async fn blocking_command<T, F>(name: &'static str, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("Failed to join {name} task: {error}"))?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RepositorySummary {
    root: String,
    branch: String,
    head: String,
    is_git_repo: bool,
    status_counts: StatusCounts,
    worktrees: Vec<WorktreeInfo>,
    branches: Vec<BranchInfo>,
    tags: Vec<TagInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeOperationResponse {
    summary: RepositorySummary,
    active_path: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum GitOperationKind {
    CherryPick,
    Merge,
    Rebase,
    Revert,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitOperationState {
    kind: Option<GitOperationKind>,
    conflict_count: usize,
    can_continue: bool,
    can_abort: bool,
    can_skip: bool,
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
    tracking: Option<CommitTrackingInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReflogEntry {
    selector: String,
    hash: String,
    short_hash: String,
    author: String,
    date: String,
    action: String,
    subject: String,
}

#[derive(Default)]
struct CommitLogFilter {
    authors: Vec<String>,
    paths: Vec<String>,
    after: Option<String>,
    before: Option<String>,
    text_terms: Vec<String>,
}

impl CommitLogFilter {
    fn parse(filter: Option<&str>) -> Self {
        let mut parsed = Self::default();
        let Some(filter) = filter.map(str::trim).filter(|value| !value.is_empty()) else {
            return parsed;
        };

        for token in tokenize_commit_filter(filter) {
            let Some((key, value)) = token.split_once(':') else {
                parsed.text_terms.push(token);
                continue;
            };
            let key = key.trim().to_ascii_lowercase();
            let value = value.trim();
            if value.is_empty() {
                parsed.text_terms.push(token);
                continue;
            }

            match key.as_str() {
                "author" => parsed.authors.push(value.to_string()),
                "path" => match normalize_user_repo_path(value) {
                    Ok(path) => parsed.paths.push(path),
                    Err(_) => parsed.text_terms.push(token),
                },
                "after" => parsed.after = Some(value.to_string()),
                "before" => parsed.before = Some(value.to_string()),
                _ => parsed.text_terms.push(token),
            }
        }

        parsed
    }

    fn has_text_terms(&self) -> bool {
        !self.text_terms.is_empty()
    }
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
struct ProjectStateFingerprint {
    fingerprint: String,
    head_fingerprint: String,
    summary_fingerprint: String,
    status_fingerprint: String,
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
struct FileBlameLine {
    line_number: usize,
    commit_hash: Option<String>,
    short_hash: Option<String>,
    author: String,
    author_time: Option<i64>,
    summary: String,
    committed: bool,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectScript {
    /// Display label, e.g. "dev", "build", "test".
    label: String,
    /// Full command to execute, e.g. "npm run dev", "cargo build".
    command: String,
    /// Source type, e.g. "npm", "cargo", "make", "deno", "go".
    source: String,
}

#[tauri::command]
async fn detect_project_scripts(path: String) -> Result<Vec<ProjectScript>, String> {
    blocking_command("detect_project_scripts", move || {
        let root = workspace_root(&path)?;
        let mut scripts = Vec::new();

        // package.json — npm/yarn/pnpm scripts
        let pkg_path = root.join("package.json");
        if pkg_path.is_file() {
            if let Ok(content) = fs::read_to_string(&pkg_path) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(scripts_obj) = json.get("scripts").and_then(|v| v.as_object()) {
                        for (name, value) in scripts_obj {
                            if let Some(_cmd) = value.as_str() {
                                scripts.push(ProjectScript {
                                    label: name.clone(),
                                    command: run_targets::package_script_command(
                                        &root, &root, name,
                                    ),
                                    source: "npm".to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }

        // Cargo.toml — cargo subcommands
        let cargo_path = root.join("Cargo.toml");
        if cargo_path.is_file() {
            let cargo_scripts = [
                ("build", "cargo build"),
                ("run", "cargo run"),
                ("test", "cargo test"),
                ("check", "cargo check"),
                ("clippy", "cargo clippy"),
                ("fmt", "cargo fmt"),
                ("doc", "cargo doc"),
            ];
            for (label, cmd) in cargo_scripts {
                scripts.push(ProjectScript {
                    label: label.to_string(),
                    command: cmd.to_string(),
                    source: "cargo".to_string(),
                });
            }
        }

        // Makefile — make targets
        let makefile_path = root.join("Makefile");
        if makefile_path.is_file() {
            if let Ok(content) = fs::read_to_string(&makefile_path) {
                for line in content.lines() {
                    let trimmed = line.trim_start();
                    if trimmed.starts_with('#') || trimmed.is_empty() {
                        continue;
                    }
                    if let Some(colon_pos) = trimmed.find(':') {
                        let target = trimmed[..colon_pos].trim();
                        // Skip pattern rules and special targets
                        if target.is_empty() || target.contains('%') || target.starts_with('.') {
                            continue;
                        }
                        scripts.push(ProjectScript {
                            label: target.to_string(),
                            command: format!("make {target}"),
                            source: "make".to_string(),
                        });
                    }
                }
            }
        }

        // deno.json — deno tasks
        let deno_path = root.join("deno.json");
        if !deno_path.is_file() {
            let deno_path2 = root.join("deno.jsonc");
            if deno_path2.is_file() {
                if let Ok(content) = fs::read_to_string(&deno_path2) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                        if let Some(tasks) = json.get("tasks").and_then(|v| v.as_object()) {
                            for (name, value) in tasks {
                                if let Some(_cmd) = value.as_str() {
                                    scripts.push(ProjectScript {
                                        label: name.clone(),
                                        command: format!("deno task {name}"),
                                        source: "deno".to_string(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        } else if let Ok(content) = fs::read_to_string(&deno_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(tasks) = json.get("tasks").and_then(|v| v.as_object()) {
                    for (name, value) in tasks {
                        if let Some(_cmd) = value.as_str() {
                            scripts.push(ProjectScript {
                                label: name.clone(),
                                command: format!("deno task {name}"),
                                source: "deno".to_string(),
                            });
                        }
                    }
                }
            }
        }

        // go.mod — go commands
        let gomod_path = root.join("go.mod");
        if gomod_path.is_file() {
            let go_scripts = [
                ("run", "go run ."),
                ("build", "go build"),
                ("test", "go test ./..."),
                ("fmt", "go fmt ./..."),
                ("vet", "go vet ./..."),
                ("mod tidy", "go mod tidy"),
            ];
            for (label, cmd) in go_scripts {
                scripts.push(ProjectScript {
                    label: label.to_string(),
                    command: cmd.to_string(),
                    source: "go".to_string(),
                });
            }
        }

        Ok(scripts)
    })
    .await
}

#[tauri::command]
async fn get_file_run_targets(
    path: String,
    file_path: String,
    content: String,
) -> Result<Vec<FileRunTarget>, String> {
    blocking_command("get_file_run_targets", move || {
        let root = workspace_root(&path)?;
        let normalized = normalize_git_path(&file_path);
        resolve_repo_child_path(&root, &normalized)?;
        run_targets::file_run_targets(&root, &normalized, &content)
    })
    .await
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
enum TerminalCursorShape {
    Block,
    Bar,
    Underline,
    HollowBlock,
}

impl Default for TerminalCursorShape {
    fn default() -> Self {
        Self::Block
    }
}

impl TerminalCursorShape {
    fn to_alacritty(self) -> CursorStyle {
        let shape = match self {
            Self::Block => CursorShape::Block,
            Self::Bar => CursorShape::Beam,
            Self::Underline => CursorShape::Underline,
            Self::HollowBlock => CursorShape::HollowBlock,
        };
        CursorStyle {
            shape,
            blinking: false,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalSpawnOptions {
    /// Shell executable to launch, or empty for the platform default.
    #[serde(default)]
    shell: String,
    /// Environment variables applied to this terminal process.
    #[serde(default)]
    env: HashMap<String, String>,
    /// Scrollback history size in lines.
    #[serde(default = "default_terminal_scrollback")]
    scrollback_lines: usize,
    /// Cursor shape for the terminal.
    #[serde(default)]
    cursor_style: TerminalCursorShape,
    /// Whether to emit visual bell events to the frontend.
    #[serde(default)]
    visual_bell: bool,
}

fn default_terminal_scrollback() -> usize {
    10000
}

impl Default for TerminalSpawnOptions {
    fn default() -> Self {
        Self {
            shell: String::new(),
            env: HashMap::new(),
            scrollback_lines: default_terminal_scrollback(),
            cursor_style: TerminalCursorShape::default(),
            visual_bell: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemFontInfo {
    family: String,
    monospace: bool,
}

enum TerminalWsEvent {
    Frame(String),
    Bell,
    Close(Option<u32>),
}

enum TerminalParserEvent {
    Output(Vec<u8>),
    Resize(u16, u16),
    /// Ask the parser thread to re-emit the current terminal frame so a newly
    /// connected WebSocket client can render the existing screen state.
    Redraw,
    /// Scroll the alternate scrollback view. Positive delta scrolls up (into
    /// history), negative scrolls down (toward the prompt). Only meaningful
    /// when the shell is not capturing the mouse, so the frontend routes wheel
    /// events here instead of sending mouse escape sequences.
    Scroll(i32),
}

#[derive(Clone)]
enum TerminalUiEvent {
    Title(Option<String>),
    SessionMetadata(TerminalSessionMetadata),
    Bell,
}

struct TerminalSession {
    parser_tx: mpsc::Sender<TerminalParserEvent>,
    resize_tx: mpsc::Sender<PtySize>,
    ws_shutdown_tx: mpsc::Sender<()>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

#[derive(Clone)]
struct TerminalEventProxy {
    input_tx: mpsc::Sender<Vec<u8>>,
    ui_event_tx: mpsc::Sender<TerminalUiEvent>,
}

#[derive(Clone, Default, PartialEq, Eq)]
struct TerminalSessionMetadata {
    command: Option<String>,
    cwd: Option<String>,
}

#[cfg(unix)]
struct TerminalSessionMetadataProbe {
    tty_fd: Option<OwnedFd>,
    fallback_pid: Option<u32>,
}

#[cfg(not(unix))]
struct TerminalSessionMetadataProbe {
    fallback_pid: Option<u32>,
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
            TerminalEvent::Bell => {
                let _ = self.ui_event_tx.send(TerminalUiEvent::Bell);
            }
            _ => {}
        }
    }
}

impl TerminalSemanticState {
    fn advance_output(&mut self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }

        let mut data = Vec::with_capacity(self.osc_buffer.len() + bytes.len());
        data.extend_from_slice(&self.osc_buffer);
        data.extend_from_slice(bytes);
        self.osc_buffer.clear();

        let mut cursor = 0;
        while let Some(relative_start) = find_bytes(&data[cursor..], b"\x1b]") {
            let start = cursor + relative_start;
            let payload_start = start + 2;
            let Some((payload_end, terminator_len)) = find_osc_terminator(&data[payload_start..])
            else {
                self.store_osc_remainder(&data[start..]);
                return;
            };
            let payload_end = payload_start + payload_end;
            self.apply_osc_payload(&data[payload_start..payload_end]);
            cursor = payload_end + terminator_len;
        }

        if data.ends_with(b"\x1b") {
            self.osc_buffer.push(b'\x1b');
        }
    }

    fn store_osc_remainder(&mut self, remainder: &[u8]) {
        if remainder.len() <= TERMINAL_OSC_BUFFER_LIMIT {
            self.osc_buffer.extend_from_slice(remainder);
        }
    }

    fn apply_osc_payload(&mut self, payload: &[u8]) {
        let payload = String::from_utf8_lossy(payload);
        if let Some(rest) = payload.strip_prefix("133;") {
            self.apply_osc_133(rest);
            return;
        }

        if let Some(url) = payload.strip_prefix("7;") {
            if let Some(path) = parse_osc7_file_url(url) {
                self.osc_cwd = Some(path);
            }
        }
    }

    fn apply_osc_133(&mut self, payload: &str) {
        let mut parts = payload.split(';');
        let marker = parts.next().unwrap_or_default();
        let status = match marker {
            "A" => TerminalCommandStatus {
                phase: TerminalCommandPhase::Prompt,
                exit_code: None,
            },
            "B" => TerminalCommandStatus {
                phase: TerminalCommandPhase::Input,
                exit_code: None,
            },
            "C" => TerminalCommandStatus {
                phase: TerminalCommandPhase::Running,
                exit_code: None,
            },
            "D" => TerminalCommandStatus {
                phase: TerminalCommandPhase::Finished,
                exit_code: parts.next().and_then(|value| value.parse::<i32>().ok()),
            },
            _ => return,
        };
        self.command_status = Some(status);
    }
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }

    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn find_osc_terminator(bytes: &[u8]) -> Option<(usize, usize)> {
    let bell = bytes.iter().position(|byte| *byte == b'\x07');
    let st = find_bytes(bytes, b"\x1b\\");
    match (bell, st) {
        (Some(bell), Some(st)) if st < bell => Some((st, 2)),
        (Some(bell), _) => Some((bell, 1)),
        (None, Some(st)) => Some((st, 2)),
        (None, None) => None,
    }
}

fn parse_osc7_file_url(url: &str) -> Option<String> {
    let rest = url.strip_prefix("file://")?;
    let path_start = rest.find('/')?;
    percent_decode_utf8(&rest[path_start..])
}

fn percent_decode_utf8(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let high = hex_value(bytes[index + 1]);
            let low = hex_value(bytes[index + 2]);
            if let (Some(high), Some(low)) = (high, low) {
                decoded.push((high << 4) | low);
                index += 3;
                continue;
            }
        }
        decoded.push(bytes[index]);
        index += 1;
    }

    String::from_utf8(decoded).ok()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[derive(Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalRunStyle {
    fg: Option<String>,
    bg: Option<String>,
    href: Option<String>,
    bold: bool,
    dim: bool,
    italic: bool,
    underline: bool,
    inverse: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalFrameGrapheme {
    text: String,
    columns: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalFrameRun {
    text: String,
    columns: usize,
    simple_ascii: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    graphemes: Option<Vec<TerminalFrameGrapheme>>,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum TerminalCommandPhase {
    Prompt,
    Input,
    Running,
    Finished,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalCommandStatus {
    phase: TerminalCommandPhase,
    exit_code: Option<i32>,
}

#[derive(Default)]
struct TerminalSemanticState {
    command_status: Option<TerminalCommandStatus>,
    osc_cwd: Option<String>,
    osc_buffer: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalFrame {
    #[serde(rename = "type")]
    message_type: &'static str,
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    osc_cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    command_status: Option<TerminalCommandStatus>,
    rows: usize,
    cols: usize,
    display_offset: usize,
    line_offset: i32,
    history_size: usize,
    cursor_row: usize,
    cursor_col: usize,
    cursor_visible: bool,
    cursor_shape: &'static str,
    modes: TerminalFrameModes,
    lines: Vec<TerminalFrameLine>,
}

#[derive(Default)]
struct TerminalState {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
    next_id: AtomicU64,
}

const TERMINAL_SCROLLBACK_CONTEXT_LINES: usize = 96;
const TERMINAL_OSC_BUFFER_LIMIT: usize = 8192;

#[tauri::command]
async fn default_start_path() -> Result<String, String> {
    blocking_command("default_start_path", move || {
        env::current_dir()
            .or_else(|_| env::var("HOME").map(PathBuf::from))
            .map(|path| path.to_string_lossy().to_string())
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
async fn list_system_fonts() -> Result<Vec<SystemFontInfo>, String> {
    blocking_command("list_system_fonts", move || Ok(system_fonts())).await
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalShell {
    /// Display label, e.g. "zsh" or "PowerShell".
    label: String,
    /// Absolute path to the shell executable.
    path: String,
}

#[tauri::command]
async fn list_terminal_shells() -> Result<Vec<TerminalShell>, String> {
    blocking_command("list_terminal_shells", move || Ok(detect_terminal_shells())).await
}

#[tauri::command]
async fn open_external_url(url: String) -> Result<(), String> {
    blocking_command("open_external_url", move || {
        let url = validated_external_url(&url)?;
        spawn_external_url_opener(url)
    })
    .await
}

fn validated_external_url(url: &str) -> Result<&str, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL cannot be empty".to_string());
    }
    if trimmed.len() > 4096 {
        return Err("URL is too long".to_string());
    }
    if trimmed.chars().any(|character| character.is_control()) {
        return Err("URL cannot contain control characters".to_string());
    }

    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("file://")
        || lower.starts_with("mailto:")
    {
        return Ok(trimmed);
    }

    Err("URL scheme is not allowed".to_string())
}

fn spawn_external_url_opener(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(url);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg(url);
        command
    };

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Failed to open URL: {error}"))
}

/// Detect shells installed on the host.
///
/// Probes a curated set of well-known shell executables by looking them up on
/// `PATH` (and a few absolute locations on Windows), returning each resolved
/// path exactly once. The platform default is represented as an empty path so
/// the frontend can offer it without duplicating a real entry.
fn detect_terminal_shells() -> Vec<TerminalShell> {
    let candidates: &[&str] = &[
        "bash",
        "zsh",
        "fish",
        "sh",
        "nu",
        "pwsh",
        "powershell",
        "pwsh.exe",
        "powershell.exe",
        "cmd.exe",
        "elvish",
        "tcsh",
        "xonsh",
    ];

    let mut shells: Vec<TerminalShell> = Vec::new();
    let mut seen: Vec<std::path::PathBuf> = Vec::new();

    for candidate in candidates {
        if let Some(path) = which_terminal_shell(candidate) {
            if seen.iter().any(|seen_path| files_equal(seen_path, &path)) {
                continue;
            }
            seen.push(path.clone());
            shells.push(TerminalShell {
                label: shell_label(candidate, &path),
                path: path.to_string_lossy().to_string(),
            });
        }
    }

    shells
}

/// Resolve `program` to an absolute executable path using `PATH`.
fn which_terminal_shell(program: &str) -> Option<std::path::PathBuf> {
    let exe_suffixes: &[&str] = if cfg!(windows) {
        &["", ".exe", ".bat", ".cmd"]
    } else {
        &[""]
    };

    // Absolute or relative path: use it directly if it exists.
    let program_path = Path::new(program);
    if program_path.is_absolute() || program.contains(std::path::MAIN_SEPARATOR) {
        return program_path.is_file().then(|| program_path.to_path_buf());
    }

    let path_env = std::env::var_os("PATH")?;
    for directory in std::env::split_paths(&path_env) {
        for suffix in exe_suffixes {
            let candidate = directory.join(format!("{program}{suffix}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    None
}

fn shell_label(program: &str, path: &Path) -> String {
    let stem = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or(program);
    match stem.to_ascii_lowercase().as_str() {
        "pwsh" => "PowerShell".to_string(),
        "powershell" => "Windows PowerShell".to_string(),
        "cmd" => "Command Prompt".to_string(),
        _ => stem.to_string(),
    }
}

#[cfg(windows)]
fn files_equal(left: &Path, right: &Path) -> bool {
    left.to_string_lossy().to_ascii_lowercase() == right.to_string_lossy().to_ascii_lowercase()
}

#[cfg(not(windows))]
fn files_equal(left: &Path, right: &Path) -> bool {
    left == right
}

#[tauri::command]
async fn load_repository(
    path: String,
    _commit: Option<String>,
    _branch: Option<String>,
) -> Result<RepositoryPayload, String> {
    blocking_command("load_repository", move || {
        let root = project_root(&path)?;
        let Some(repository_root) = discover_repository_root(&root)? else {
            return Ok(RepositoryPayload {
                summary: non_git_project_summary(&root),
                commits: Vec::new(),
                files: Vec::new(),
            });
        };
        let summary = repository_summary(&repository_root)?;

        Ok(RepositoryPayload {
            summary,
            commits: Vec::new(),
            files: Vec::new(),
        })
    })
    .await
}

#[tauri::command]
async fn get_diff(path: String, commit: Option<String>) -> Result<String, String> {
    blocking_command("get_diff", move || {
        let root = repository_root(&path)?;
        match commit {
            Some(hash) if !hash.trim().is_empty() => git_show(&root, hash.trim()),
            _ => git_diff(&root),
        }
    })
    .await
}

#[tauri::command]
async fn get_file_diff(
    path: String,
    commit: Option<String>,
    file_path: String,
) -> Result<String, String> {
    blocking_command("get_file_diff", move || {
        let root = repository_root(&path)?;
        match commit {
            Some(hash) if !hash.trim().is_empty() => git_show_file(&root, hash.trim(), &file_path),
            _ => git_worktree_file_diff(&root, &file_path),
        }
    })
    .await
}

#[tauri::command]
async fn get_commits(
    path: String,
    branch: Option<String>,
    filter: Option<String>,
) -> Result<Vec<CommitInfo>, String> {
    blocking_command("get_commits", move || {
        let root = repository_root(&path)?;
        git_log(&root, branch.as_deref(), filter.as_deref())
    })
    .await
}

#[tauri::command]
async fn get_reflog(path: String, filter: Option<String>) -> Result<Vec<ReflogEntry>, String> {
    blocking_command("get_reflog", move || {
        let root = repository_root(&path)?;
        git_reflog(&root, filter.as_deref())
    })
    .await
}

#[tauri::command]
async fn get_project_files(path: String) -> Result<Vec<TreeFile>, String> {
    blocking_command("get_project_files", move || {
        let root = project_root(&path)?;
        match discover_repository_root(&root)? {
            Some(repository_root) => git_files(&repository_root),
            None => workspace_files(&root),
        }
    })
    .await
}

#[tauri::command]
async fn get_project_state_fingerprint(path: String) -> Result<ProjectStateFingerprint, String> {
    blocking_command("get_project_state_fingerprint", move || {
        let root = project_root(&path)?;
        let (fingerprint, head_fingerprint, summary_fingerprint, status_fingerprint) =
            match discover_repository_root(&root)? {
                Some(repository_root) => git_project_state_fingerprint(&repository_root)?,
                None => plain_project_state_fingerprint(&root)?,
            };

        Ok(ProjectStateFingerprint {
            fingerprint,
            head_fingerprint,
            summary_fingerprint,
            status_fingerprint,
        })
    })
    .await
}

#[tauri::command]
async fn get_changed_files(path: String, commit: Option<String>) -> Result<Vec<TreeFile>, String> {
    blocking_command("get_changed_files", move || {
        let root = repository_root(&path)?;
        changed_files(&root, commit.as_deref())
    })
    .await
}

#[tauri::command]
async fn get_file_content(path: String, file_path: String) -> Result<FileContent, String> {
    blocking_command("get_file_content", move || {
        let root = workspace_root(&path)?;
        read_file_content(&root, &file_path)
    })
    .await
}

#[tauri::command]
async fn resolve_import_path(
    path: String,
    current_file_path: String,
    import_path: String,
) -> Result<Option<String>, String> {
    blocking_command("resolve_import_path", move || {
        let root = workspace_root(&path)?;
        resolve_import_path_in_root(&root, &current_file_path, &import_path)
    })
    .await
}

#[tauri::command]
async fn get_file_blame(path: String, file_path: String) -> Result<Vec<FileBlameLine>, String> {
    blocking_command("get_file_blame", move || {
        let root = repository_root(&path)?;
        git_file_blame(&root, &file_path)
    })
    .await
}

#[tauri::command]
async fn save_file_content(request: SaveFileRequest) -> Result<SaveFileResponse, String> {
    blocking_command("save_file_content", move || {
        let root = workspace_root(&request.path)?;
        write_file_content(
            &root,
            &request.file_path,
            &request.base_content,
            &request.content,
        )
    })
    .await
}

#[tauri::command]
async fn create_project_file(path: String, file_path: String) -> Result<String, String> {
    blocking_command("create_project_file", move || {
        let root = workspace_root(&path)?;
        create_repo_file(&root, &file_path)
    })
    .await
}

#[tauri::command]
async fn rename_project_file(
    path: String,
    from_path: String,
    to_path: String,
) -> Result<String, String> {
    blocking_command("rename_project_file", move || {
        let root = workspace_root(&path)?;
        rename_repo_file(&root, &from_path, &to_path)
    })
    .await
}

#[tauri::command]
async fn delete_project_file(path: String, file_path: String) -> Result<(), String> {
    blocking_command("delete_project_file", move || {
        let root = workspace_root(&path)?;
        delete_repo_file(&root, &file_path)
    })
    .await
}

#[tauri::command]
async fn search_file_names(
    path: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<FileSearchResult>, String> {
    blocking_command("search_file_names", move || {
        let root = workspace_root(&path)?;
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
    })
    .await
}

#[tauri::command]
async fn search_file_contents(
    path: String,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<FileSearchResult>, String> {
    blocking_command("search_file_contents", move || {
        let root = workspace_root(&path)?;
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
                match_ranges: matched
                    .match_byte_offsets
                    .iter()
                    .map(|(s, e)| (*s, *e))
                    .collect(),
            });
            if results.len() >= limit {
                break;
            }
        }
        Ok(results)
    })
    .await
}

#[tauri::command]
async fn search_symbol_references(
    path: String,
    query: String,
    limit: Option<usize>,
    current_file_path: Option<String>,
) -> Result<Vec<FileSearchResult>, String> {
    blocking_command("search_symbol_references", move || {
        let root = workspace_root(&path)?;
        let limit = limit
            .unwrap_or(DEFAULT_FILE_SEARCH_LIMIT)
            .clamp(1, MAX_FILE_SEARCH_LIMIT);
        code_search::search_symbol_references_in_root(
            &root,
            &query,
            limit,
            current_file_path.as_deref(),
        )
    })
    .await
}

#[tauri::command]
async fn cancel_symbol_reference_search(path: String) -> Result<(), String> {
    blocking_command("cancel_symbol_reference_search", move || {
        let root = workspace_root(&path)?;
        code_search::cancel_symbol_reference_search_in_root(&root)
    })
    .await
}

#[tauri::command]
async fn search_editor_text(
    content: String,
    query: String,
) -> Result<EditorSearchResponse, String> {
    blocking_command("search_editor_text", move || {
        Ok(EditorSearchResponse {
            matches: editor_text_matches(&content, &query)
                .into_iter()
                .map(EditorTextMatch::from)
                .collect(),
        })
    })
    .await
}

#[tauri::command]
async fn replace_editor_text(
    content: String,
    query: String,
    replacement: String,
    active_index: usize,
    replace_all: bool,
) -> Result<EditorReplaceResponse, String> {
    blocking_command("replace_editor_text", move || {
        Ok(replace_editor_content(
            &content,
            &query,
            &replacement,
            active_index,
            replace_all,
        ))
    })
    .await
}

#[tauri::command]
async fn fetch_remotes(path: String) -> Result<(), String> {
    blocking_command("fetch_remotes", move || {
        let root = repository_root(&path)?;
        git(&root, &["fetch", "--all", "--prune"])?;
        Ok(())
    })
    .await
}

#[tauri::command]
async fn checkout_branch(path: String, ref_name: String) -> Result<(), String> {
    blocking_command("checkout_branch", move || {
        let root = repository_root(&path)?;
        checkout_branch_ref(&root, &ref_name)
    })
    .await
}

#[tauri::command]
async fn create_branch(path: String, name: String, start_point: String) -> Result<(), String> {
    blocking_command("create_branch", move || {
        let root = repository_root(&path)?;
        validate_branch_name(&root, &name)?;
        validate_branch_start_point(&start_point)?;
        git(&root, &["switch", "-c", &name, &start_point])?;
        Ok(())
    })
    .await
}

#[tauri::command]
async fn create_worktree(
    path: String,
    name: String,
    start_point: String,
    branch_name: Option<String>,
) -> Result<WorktreeOperationResponse, String> {
    blocking_command("create_worktree", move || {
        let root = repository_root(&path)?;
        create_sibling_worktree(&root, &name, &start_point, branch_name.as_deref())
    })
    .await
}

#[tauri::command]
async fn remove_worktree(
    path: String,
    worktree_path: String,
    force: bool,
) -> Result<WorktreeOperationResponse, String> {
    blocking_command("remove_worktree", move || {
        let root = repository_root(&path)?;
        remove_known_worktree(&root, &worktree_path, force)
    })
    .await
}

#[tauri::command]
async fn prune_worktrees(path: String) -> Result<WorktreeOperationResponse, String> {
    blocking_command("prune_worktrees", move || {
        let root = repository_root(&path)?;
        prune_known_worktrees(&root)
    })
    .await
}

#[tauri::command]
async fn rename_branch(path: String, ref_name: String, new_name: String) -> Result<(), String> {
    blocking_command("rename_branch", move || {
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
    })
    .await
}

#[tauri::command]
async fn delete_branch(path: String, ref_name: String, force: bool) -> Result<(), String> {
    blocking_command("delete_branch", move || {
        let root = repository_root(&path)?;
        let current = current_branch(&root);
        let branch = local_branch_name(&ref_name)?;
        if current.as_deref() == Some(branch.as_str()) {
            return Err("Cannot delete the checked-out branch".to_string());
        }
        let flag = if force { "-D" } else { "-d" };
        git(&root, &["branch", flag, &branch])?;
        Ok(())
    })
    .await
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
async fn pull_current_branch(path: String, mode: String) -> Result<(), String> {
    blocking_command("pull_current_branch", move || {
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
    })
    .await
}

#[tauri::command]
async fn get_git_operation_state(path: String) -> Result<GitOperationState, String> {
    blocking_command("get_git_operation_state", move || {
        let root = repository_root(&path)?;
        git_operation_state_for_repo(&root)
    })
    .await
}

#[tauri::command]
async fn continue_git_operation(path: String) -> Result<git_write::GitWriteResponse, String> {
    blocking_command("continue_git_operation", move || {
        let root = repository_root(&path)?;
        run_git_operation(&root, GitOperationAction::Continue)
    })
    .await
}

#[tauri::command]
async fn abort_git_operation(path: String) -> Result<git_write::GitWriteResponse, String> {
    blocking_command("abort_git_operation", move || {
        let root = repository_root(&path)?;
        run_git_operation(&root, GitOperationAction::Abort)
    })
    .await
}

#[tauri::command]
async fn skip_git_operation(path: String) -> Result<git_write::GitWriteResponse, String> {
    blocking_command("skip_git_operation", move || {
        let root = repository_root(&path)?;
        run_git_operation(&root, GitOperationAction::Skip)
    })
    .await
}

#[derive(Clone, Copy)]
enum GitOperationAction {
    Abort,
    Continue,
    Skip,
}

fn git_operation_state_for_repo(root: &Path) -> Result<GitOperationState, String> {
    let kind = detect_git_operation_kind(root)?;
    let conflict_count = worktree_changed_files(root)?
        .iter()
        .filter(|file| file.conflict)
        .count();
    let can_skip = matches!(
        kind,
        Some(GitOperationKind::CherryPick | GitOperationKind::Rebase | GitOperationKind::Revert)
    );

    Ok(GitOperationState {
        kind,
        conflict_count,
        can_continue: kind.is_some(),
        can_abort: kind.is_some(),
        can_skip,
    })
}

fn detect_git_operation_kind(root: &Path) -> Result<Option<GitOperationKind>, String> {
    if git_internal_path(root, "rebase-merge")?.is_dir()
        || git_internal_path(root, "rebase-apply")?.is_dir()
    {
        return Ok(Some(GitOperationKind::Rebase));
    }
    if git_internal_path(root, "MERGE_HEAD")?.is_file() {
        return Ok(Some(GitOperationKind::Merge));
    }
    if git_internal_path(root, "CHERRY_PICK_HEAD")?.is_file() {
        return Ok(Some(GitOperationKind::CherryPick));
    }
    if git_internal_path(root, "REVERT_HEAD")?.is_file() {
        return Ok(Some(GitOperationKind::Revert));
    }

    Ok(None)
}

fn run_git_operation(
    root: &Path,
    action: GitOperationAction,
) -> Result<git_write::GitWriteResponse, String> {
    let state = git_operation_state_for_repo(root)?;
    let kind = state
        .kind
        .ok_or_else(|| "No merge, rebase, cherry-pick, or revert is in progress".to_string())?;
    if matches!(action, GitOperationAction::Skip) && !state.can_skip {
        return Err("This Git operation does not support skip".to_string());
    }

    let args = git_operation_args(kind, action);
    git_with_env(
        root,
        args,
        &[
            ("GIT_EDITOR", "true"),
            ("GIT_SEQUENCE_EDITOR", "true"),
            ("GIT_MERGE_AUTOEDIT", "no"),
        ],
    )?;
    Ok(git_write::GitWriteResponse {
        summary: repository_summary(root)?,
        files: worktree_changed_files(root)?,
    })
}

fn git_operation_args(
    kind: GitOperationKind,
    action: GitOperationAction,
) -> &'static [&'static str] {
    match (kind, action) {
        (GitOperationKind::Merge, GitOperationAction::Abort) => &["merge", "--abort"],
        (GitOperationKind::Merge, GitOperationAction::Continue) => &["merge", "--continue"],
        (GitOperationKind::Merge, GitOperationAction::Skip) => &["merge", "--abort"],
        (GitOperationKind::Rebase, GitOperationAction::Abort) => &["rebase", "--abort"],
        (GitOperationKind::Rebase, GitOperationAction::Continue) => &["rebase", "--continue"],
        (GitOperationKind::Rebase, GitOperationAction::Skip) => &["rebase", "--skip"],
        (GitOperationKind::CherryPick, GitOperationAction::Abort) => &["cherry-pick", "--abort"],
        (GitOperationKind::CherryPick, GitOperationAction::Continue) => {
            &["cherry-pick", "--continue"]
        }
        (GitOperationKind::CherryPick, GitOperationAction::Skip) => &["cherry-pick", "--skip"],
        (GitOperationKind::Revert, GitOperationAction::Abort) => &["revert", "--abort"],
        (GitOperationKind::Revert, GitOperationAction::Continue) => &["revert", "--continue"],
        (GitOperationKind::Revert, GitOperationAction::Skip) => &["revert", "--skip"],
    }
}

fn git_internal_path(root: &Path, path: &str) -> Result<PathBuf, String> {
    let output = git(root, &["rev-parse", "--git-path", path])?;
    let value = output.trim();
    if value.is_empty() {
        return Err(format!("Git did not return a path for {path}"));
    }
    let git_path = PathBuf::from(value);
    if git_path.is_absolute() {
        Ok(git_path)
    } else {
        Ok(root.join(git_path))
    }
}

#[tauri::command]
fn terminal_spawn(
    state: State<'_, TerminalState>,
    path: String,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    options: Option<TerminalSpawnOptions>,
) -> Result<TerminalSessionInfo, String> {
    let root = workspace_root(&path)?;
    spawn_terminal_session_with_options(
        state.inner(),
        &root,
        cwd.as_deref(),
        cols,
        rows,
        options.unwrap_or_default(),
    )
}

#[tauri::command]
async fn terminal_resize(
    state: State<'_, TerminalState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    resize_terminal_session(&state.sessions, &id, cols, rows)
}

#[tauri::command]
async fn terminal_scroll(
    state: State<'_, TerminalState>,
    id: String,
    delta: i32,
) -> Result<(), String> {
    scroll_terminal_session(&state.sessions, &id, delta)
}

#[tauri::command]
fn terminal_kill(state: State<TerminalState>, id: String) -> Result<(), String> {
    kill_terminal_session(state.inner(), &id)
}

fn resize_terminal_session(
    sessions: &Arc<Mutex<HashMap<String, TerminalSession>>>,
    id: &str,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let (resize_tx, parser_tx) = {
        let sessions = sessions.lock().map_err(|error| error.to_string())?;
        let session = sessions
            .get(id)
            .ok_or_else(|| "Terminal session was not found".to_string())?;
        (session.resize_tx.clone(), session.parser_tx.clone())
    };
    let cols = cols.max(1);
    let rows = rows.max(1);
    resize_tx
        .send(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Failed to schedule terminal resize: {error}"))?;
    let _ = parser_tx.send(TerminalParserEvent::Resize(cols, rows));
    Ok(())
}

fn scroll_terminal_session(
    sessions: &Arc<Mutex<HashMap<String, TerminalSession>>>,
    id: &str,
    delta: i32,
) -> Result<(), String> {
    let parser_tx = {
        let sessions = sessions.lock().map_err(|error| error.to_string())?;
        sessions
            .get(id)
            .ok_or_else(|| "Terminal session was not found".to_string())?
            .parser_tx
            .clone()
    };
    // The parser thread applies the scroll and re-emits a frame, so the
    // connected WebSocket client renders the scrolled view.
    let _ = parser_tx.send(TerminalParserEvent::Scroll(delta));
    Ok(())
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
        is_git_repo: true,
        status_counts: count_statuses(&status).unwrap_or_default(),
        worktrees,
        branches,
        tags,
    })
}

fn non_git_project_summary(root: &Path) -> RepositorySummary {
    RepositorySummary {
        root: root.to_string_lossy().to_string(),
        branch: String::new(),
        head: String::new(),
        is_git_repo: false,
        status_counts: StatusCounts::default(),
        worktrees: Vec::new(),
        branches: Vec::new(),
        tags: Vec::new(),
    }
}

fn project_root(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);
    if !candidate.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    let canonical = candidate
        .canonicalize()
        .map_err(|error| format!("Failed to resolve project folder: {error}"))?;
    if !canonical.is_dir() {
        return Err(format!("Path is not a directory: {path}"));
    }

    Ok(canonical)
}

pub(crate) fn workspace_root(path: &str) -> Result<PathBuf, String> {
    let root = project_root(path)?;
    Ok(discover_repository_root(&root)?.unwrap_or(root))
}

fn repository_root(path: &str) -> Result<PathBuf, String> {
    let root = project_root(path)?;
    discover_repository_root(&root)?.ok_or_else(|| "Not a git repository".to_string())
}

fn discover_repository_root(path: &Path) -> Result<Option<PathBuf>, String> {
    let output = Command::new("git")
        .args([
            "-C",
            path.to_string_lossy().as_ref(),
            "rev-parse",
            "--show-toplevel",
        ])
        .output()
        .map_err(|error| format!("Failed to run git: {error}"))?;

    if output.status.success() {
        return Ok(Some(PathBuf::from(
            String::from_utf8_lossy(&output.stdout).trim(),
        )));
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    if is_not_git_repository_message(&stderr) {
        return Ok(None);
    }

    Err(stderr_or_status(
        "Failed to inspect Git repository",
        output.stderr,
    ))
}

fn is_not_git_repository_message(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("not a git repository")
        || lower.contains("outside repository")
        || lower.contains("cannot chdir")
}

fn git_log(
    root: &Path,
    branch: Option<&str>,
    filter: Option<&str>,
) -> Result<Vec<CommitInfo>, String> {
    let target = branch.filter(|value| !value.trim().is_empty());
    let tracking_selection = git_tracking::tracking_selection_for_target(root, target, git);
    let commit_filter = CommitLogFilter::parse(filter);
    let mut args = vec![
        "log".to_string(),
        "--topo-order".to_string(),
        "--date=iso-strict".to_string(),
        "--pretty=format:%H%x1f%h%x1f%P%x1f%an%x1f%ad%x1f%s".to_string(),
    ];

    if let Some(after) = commit_filter.after.as_deref() {
        args.push(format!("--since={after}"));
    }
    if let Some(before) = commit_filter.before.as_deref() {
        args.push(format!("--until={before}"));
    }
    for author in &commit_filter.authors {
        args.push(format!("--author={author}"));
    }
    if !commit_filter.has_text_terms() {
        args.push("-n".to_string());
        args.push("120".to_string());
    }

    if let Some(selection) = tracking_selection.as_ref() {
        args.push(selection.left_ref.clone());
        args.push(selection.right_ref.clone());
    } else if let Some(target) = target {
        args.push(target.to_string());
    }

    if !commit_filter.paths.is_empty() {
        args.push("--".to_string());
        args.extend(commit_filter.paths.iter().cloned());
    }

    let output = git_owned(root, &args).unwrap_or_default();
    let mut commits = output
        .lines()
        .filter_map(parse_commit_log_line)
        .filter(|commit| matches_commit_text_terms(commit, &commit_filter.text_terms))
        .collect::<Vec<_>>();

    if let Some(selection) = tracking_selection.as_ref() {
        if let Ok(tracking_map) = git_tracking::commit_tracking_map(root, selection, git) {
            for commit in &mut commits {
                commit.tracking = tracking_map.get(&commit.hash).cloned();
            }
        }
    }

    if commit_filter.has_text_terms() {
        Ok(commits.into_iter().take(120).collect())
    } else {
        Ok(commits)
    }
}

fn git_reflog(root: &Path, filter: Option<&str>) -> Result<Vec<ReflogEntry>, String> {
    let text_terms = filter
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(tokenize_commit_filter)
        .unwrap_or_default();
    let mut args = vec![
        "reflog".to_string(),
        "--pretty=format:%gD%x1f%H%x1f%h%x1f%an%x1f%cI%x1f%gs%x1f%s".to_string(),
    ];

    if text_terms.is_empty() {
        args.push("-n".to_string());
        args.push("120".to_string());
    }

    let output = git_owned(root, &args).unwrap_or_default();
    let entries = output
        .lines()
        .filter_map(parse_reflog_line)
        .filter(|entry| matches_reflog_text_terms(entry, &text_terms));

    if text_terms.is_empty() {
        Ok(entries.collect())
    } else {
        Ok(entries.take(120).collect())
    }
}

#[derive(Default)]
struct PendingFileBlameLine {
    line_number: usize,
    commit_hash: String,
    author: String,
    author_time: Option<i64>,
    summary: String,
}

impl PendingFileBlameLine {
    fn into_file_blame_line(self) -> FileBlameLine {
        if self.commit_hash == ZERO_OID {
            return FileBlameLine {
                line_number: self.line_number,
                commit_hash: None,
                short_hash: None,
                author: "Not Committed Yet".to_string(),
                author_time: None,
                summary: "Uncommitted changes".to_string(),
                committed: false,
            };
        }

        let summary = if self.summary.trim().is_empty() {
            "No commit summary".to_string()
        } else {
            self.summary
        };
        let author = if self.author.trim().is_empty() {
            "Unknown author".to_string()
        } else {
            self.author
        };

        FileBlameLine {
            line_number: self.line_number,
            commit_hash: Some(self.commit_hash.clone()),
            short_hash: Some(self.commit_hash.chars().take(8).collect::<String>()),
            author,
            author_time: self.author_time,
            summary,
            committed: true,
        }
    }
}

fn git_file_blame(root: &Path, file_path: &str) -> Result<Vec<FileBlameLine>, String> {
    let output = match git(root, &["blame", "--line-porcelain", "--", file_path]) {
        Ok(output) => output,
        Err(error) if is_missing_blame_target_error(&error) => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };

    Ok(parse_file_blame(&output))
}

fn parse_file_blame(output: &str) -> Vec<FileBlameLine> {
    let mut blame_lines = Vec::new();
    let mut current: Option<PendingFileBlameLine> = None;

    for line in output.lines() {
        if let Some((commit_hash, line_number)) = parse_blame_header(line) {
            current = Some(PendingFileBlameLine {
                line_number,
                commit_hash,
                ..Default::default()
            });
            continue;
        }

        let Some(entry) = current.as_mut() else {
            continue;
        };

        if let Some(author) = line.strip_prefix("author ") {
            entry.author = author.to_string();
            continue;
        }

        if let Some(author_time) = line.strip_prefix("author-time ") {
            entry.author_time = author_time.parse::<i64>().ok();
            continue;
        }

        if let Some(summary) = line.strip_prefix("summary ") {
            entry.summary = summary.to_string();
            continue;
        }

        if line.starts_with('\t') {
            if let Some(entry) = current.take() {
                blame_lines.push(entry.into_file_blame_line());
            }
        }
    }

    blame_lines
}

fn parse_blame_header(line: &str) -> Option<(String, usize)> {
    let mut parts = line.split_whitespace();
    let commit_hash = parts.next()?;
    if commit_hash.len() != 40
        || !commit_hash
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return None;
    }

    parts.next()?.parse::<usize>().ok()?;
    let line_number = parts.next()?.parse::<usize>().ok()?;

    Some((commit_hash.to_string(), line_number))
}

fn is_missing_blame_target_error(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();
    lower.contains("no such path")
        || lower.contains("no such file")
        || lower.contains("cannot stat path")
        || lower.contains("is outside repository")
}

fn tokenize_commit_filter(filter: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    let mut escaped = false;

    for character in filter.chars() {
        if escaped {
            current.push(character);
            escaped = false;
            continue;
        }

        match character {
            '\\' if quote.is_some() => escaped = true,
            '"' | '\'' => {
                if Some(character) == quote {
                    quote = None;
                } else if quote.is_none() {
                    quote = Some(character);
                } else {
                    current.push(character);
                }
            }
            character if character.is_whitespace() && quote.is_none() => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(character),
        }
    }

    if escaped {
        current.push('\\');
    }
    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

fn parse_commit_log_line(line: &str) -> Option<CommitInfo> {
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
        tracking: None,
    })
}

fn parse_reflog_line(line: &str) -> Option<ReflogEntry> {
    let parts: Vec<&str> = line.split('\x1f').collect();
    (parts.len() == 7).then(|| ReflogEntry {
        selector: parts[0].to_string(),
        hash: parts[1].to_string(),
        short_hash: parts[2].to_string(),
        author: parts[3].to_string(),
        date: parts[4].to_string(),
        action: parts[5].to_string(),
        subject: parts[6].to_string(),
    })
}

fn matches_commit_text_terms(commit: &CommitInfo, text_terms: &[String]) -> bool {
    matches_search_terms(
        &[
            commit.subject.as_str(),
            commit.author.as_str(),
            commit.hash.as_str(),
            commit.short_hash.as_str(),
        ],
        text_terms,
    )
}

fn matches_reflog_text_terms(entry: &ReflogEntry, text_terms: &[String]) -> bool {
    matches_search_terms(
        &[
            entry.selector.as_str(),
            entry.action.as_str(),
            entry.subject.as_str(),
            entry.author.as_str(),
            entry.hash.as_str(),
            entry.short_hash.as_str(),
        ],
        text_terms,
    )
}

fn matches_search_terms(fields: &[&str], text_terms: &[String]) -> bool {
    if text_terms.is_empty() {
        return true;
    }

    let haystack = fields.join(" ").to_ascii_lowercase();
    text_terms
        .iter()
        .all(|term| haystack.contains(&term.to_ascii_lowercase()))
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

fn create_sibling_worktree(
    root: &Path,
    name: &str,
    start_point: &str,
    branch_name: Option<&str>,
) -> Result<WorktreeOperationResponse, String> {
    let target = sibling_worktree_path(root, name)?;
    validate_branch_start_point(start_point)?;
    let branch_name = branch_name
        .map(str::trim)
        .filter(|branch| !branch.is_empty())
        .map(str::to_string);
    if let Some(branch_name) = branch_name.as_deref() {
        validate_branch_name(root, branch_name)?;
    }

    let target_path = target.to_string_lossy().to_string();
    let mut args = vec!["worktree".to_string(), "add".to_string()];
    if let Some(branch_name) = branch_name.as_deref() {
        args.push("-b".to_string());
        args.push(branch_name.to_string());
    }
    args.push(target_path.clone());
    args.push(start_point.trim().to_string());
    git_owned(root, &args)?;

    Ok(WorktreeOperationResponse {
        summary: repository_summary(root)?,
        active_path: Some(target_path),
    })
}

fn remove_known_worktree(
    root: &Path,
    worktree_path: &str,
    force: bool,
) -> Result<WorktreeOperationResponse, String> {
    let known_path = resolve_known_non_active_worktree(root, worktree_path)?;
    let known_path = known_path.to_string_lossy().to_string();
    let mut args = vec!["worktree".to_string(), "remove".to_string()];
    if force {
        args.push("--force".to_string());
    }
    args.push(known_path);
    git_owned(root, &args)?;

    Ok(WorktreeOperationResponse {
        summary: repository_summary(root)?,
        active_path: None,
    })
}

fn prune_known_worktrees(root: &Path) -> Result<WorktreeOperationResponse, String> {
    git(root, &["worktree", "prune"])?;
    Ok(WorktreeOperationResponse {
        summary: repository_summary(root)?,
        active_path: None,
    })
}

fn sibling_worktree_path(root: &Path, name: &str) -> Result<PathBuf, String> {
    let name = validate_sibling_worktree_name(name)?;
    let root = root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve repository root: {error}"))?;
    let parent = root
        .parent()
        .ok_or_else(|| "Repository root has no parent directory".to_string())?;
    let target = parent.join(name);
    if target.exists() {
        return Err("Worktree folder already exists".to_string());
    }

    Ok(target)
}

fn validate_sibling_worktree_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim().trim_matches('"').replace('\\', "/");
    if trimmed.is_empty() {
        return Err("Worktree name is required".to_string());
    }
    if trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || Path::new(&trimmed).is_absolute()
    {
        return Err("Worktree name must be a single folder name".to_string());
    }
    if trimmed.starts_with('-') {
        return Err("Worktree name cannot start with -".to_string());
    }
    validate_cross_platform_path_part(&trimmed)?;

    Ok(trimmed)
}

fn resolve_known_non_active_worktree(root: &Path, worktree_path: &str) -> Result<PathBuf, String> {
    let active_root = root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve active worktree: {error}"))?;
    let requested = PathBuf::from(worktree_path.trim())
        .canonicalize()
        .map_err(|error| format!("Failed to resolve worktree path: {error}"))?;
    if paths_equal(&requested, &active_root) {
        return Err("Cannot remove the active worktree".to_string());
    }

    let worktrees = parse_worktrees(&git(root, &["worktree", "list", "--porcelain"])?);
    for worktree in worktrees {
        let known = PathBuf::from(worktree.path)
            .canonicalize()
            .map_err(|error| format!("Failed to resolve known worktree path: {error}"))?;
        if paths_equal(&known, &requested) {
            return Ok(known);
        }
    }

    Err("Can only remove a known worktree".to_string())
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    path_starts_with(left, right) && path_starts_with(right, left)
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

pub(crate) fn normalize_user_repo_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim().trim_matches('"').replace('\\', "/");
    if trimmed
        .split('/')
        .next()
        .is_some_and(|part| part.len() == 2 && part.ends_with(':'))
    {
        return Err("Use a path relative to the project root".to_string());
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

fn git_project_state_fingerprint(root: &Path) -> Result<(String, String, String, String), String> {
    let status = git(
        root,
        &[
            "status",
            "--porcelain=v2",
            "-z",
            "-uall",
            "--renames",
            "--branch",
        ],
    )?;
    let (head, summary, file_status) = split_status_v2_fingerprint_inputs(&status);
    let head_fingerprint = stable_text_fingerprint(&head);
    let summary_fingerprint = stable_text_fingerprint(&summary);
    let status_fingerprint = stable_text_fingerprint(&file_status);
    Ok((
        format!("{head_fingerprint}:{summary_fingerprint}:{status_fingerprint}"),
        head_fingerprint,
        summary_fingerprint,
        status_fingerprint,
    ))
}

fn split_status_v2_fingerprint_inputs(status: &str) -> (String, String, String) {
    let mut head = String::new();
    let mut summary = String::new();
    let mut file_status = String::with_capacity(status.len());

    for entry in status.split('\0') {
        if entry.is_empty() {
            continue;
        }
        if let Some(oid) = entry.strip_prefix("# branch.oid ") {
            head = oid.to_string();
            continue;
        }
        if entry.starts_with("# branch.") {
            summary.push_str(entry);
            summary.push('\0');
            continue;
        }
        file_status.push_str(entry);
        file_status.push('\0');
    }

    (head, summary, file_status)
}

fn plain_project_state_fingerprint(
    root: &Path,
) -> Result<(String, String, String, String), String> {
    let metadata = fs::metadata(root)
        .map_err(|error| format!("Failed to read project folder metadata: {error}"))?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let status_fingerprint =
        stable_text_fingerprint(&format!("{}:{modified}", root.to_string_lossy()));
    Ok((
        format!("plain:{status_fingerprint}"),
        String::new(),
        String::new(),
        status_fingerprint,
    ))
}

fn stable_text_fingerprint(value: &str) -> String {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn workspace_files(root: &Path) -> Result<Vec<TreeFile>, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve project root: {error}"))?;
    let mut directories = vec![root.clone()];
    let mut files = Vec::new();

    while let Some(directory) = directories.pop() {
        let mut entries = fs::read_dir(&directory)
            .map_err(|error| format!("Failed to read project files: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Failed to read project files: {error}"))?;
        entries.sort_by_key(|entry| entry.path());

        for entry in entries {
            let entry_path = entry.path();
            let file_type = entry
                .file_type()
                .map_err(|error| format!("Failed to read project file metadata: {error}"))?;

            if file_type.is_dir() {
                if entry.file_name() == ".git" {
                    continue;
                }
                directories.push(entry_path);
                continue;
            }

            if !file_type.is_file() && !entry_path.is_file() {
                continue;
            }

            let relative = entry_path
                .strip_prefix(&root)
                .map_err(|error| format!("Failed to resolve project file path: {error}"))?;
            files.push(TreeFile {
                path: relative.to_string_lossy().replace('\\', "/"),
                ..TreeFile::default()
            });
        }
    }

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

fn resolve_import_path_in_root(
    root: &Path,
    current_file_path: &str,
    import_path: &str,
) -> Result<Option<String>, String> {
    let current_file_path = normalize_user_repo_path(current_file_path)?;
    let import_path = strip_import_suffix(import_path.trim());
    if import_path.is_empty() || import_path.contains('\0') {
        return Ok(None);
    }

    for base in import_base_candidates(root, &current_file_path, import_path)? {
        for candidate in module_file_candidates(&base) {
            if let Some(path) = existing_module_file(root, &candidate)? {
                return Ok(Some(path));
            }
        }
    }

    Ok(None)
}

fn strip_import_suffix(import_path: &str) -> &str {
    import_path
        .split(['?', '#'])
        .next()
        .unwrap_or(import_path)
        .trim()
}

fn import_base_candidates(
    root: &Path,
    current_file_path: &str,
    import_path: &str,
) -> Result<Vec<String>, String> {
    let mut candidates = Vec::new();

    if import_path.starts_with("./") || import_path.starts_with("../") {
        let current_parent = Path::new(current_file_path)
            .parent()
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        push_normalized_candidate(&mut candidates, &format!("{current_parent}/{import_path}"))?;
        return Ok(candidates);
    }

    candidates.extend(tsconfig_path_candidates(root, import_path)?);

    if let Some(rest) = import_path.strip_prefix("@/") {
        push_normalized_candidate(&mut candidates, &format!("src/{rest}"))?;
    }
    if let Some(rest) = import_path.strip_prefix("~/") {
        push_normalized_candidate(&mut candidates, rest)?;
    }
    if import_path.starts_with('/') {
        push_normalized_candidate(&mut candidates, import_path.trim_start_matches('/'))?;
    }

    Ok(candidates)
}

fn tsconfig_path_candidates(root: &Path, import_path: &str) -> Result<Vec<String>, String> {
    let mut candidates = Vec::new();
    for config_name in ["tsconfig.json", "jsconfig.json", "tsconfig.base.json"] {
        let config_path = root.join(config_name);
        let Ok(content) = fs::read_to_string(config_path) else {
            continue;
        };
        let Ok(config) = serde_json::from_str::<serde_json::Value>(&content) else {
            continue;
        };
        let compiler_options = config
            .get("compilerOptions")
            .and_then(serde_json::Value::as_object);
        let Some(compiler_options) = compiler_options else {
            continue;
        };
        let base_url = compiler_options
            .get("baseUrl")
            .and_then(serde_json::Value::as_str)
            .unwrap_or(".");
        let Some(paths) = compiler_options
            .get("paths")
            .and_then(serde_json::Value::as_object)
        else {
            continue;
        };

        for (pattern, targets) in paths {
            let Some(capture) = match_tsconfig_path_pattern(pattern, import_path) else {
                continue;
            };
            let Some(targets) = targets.as_array() else {
                continue;
            };
            for target in targets.iter().filter_map(serde_json::Value::as_str) {
                let expanded = expand_tsconfig_target(target, capture);
                push_normalized_candidate(&mut candidates, &format!("{base_url}/{expanded}"))?;
            }
        }
    }
    Ok(candidates)
}

fn match_tsconfig_path_pattern<'a>(pattern: &str, import_path: &'a str) -> Option<&'a str> {
    let Some(star_index) = pattern.find('*') else {
        return (pattern == import_path).then_some("");
    };
    let prefix = &pattern[..star_index];
    let suffix = &pattern[star_index + 1..];
    let rest = import_path.strip_prefix(prefix)?;
    rest.strip_suffix(suffix)
}

fn expand_tsconfig_target(target: &str, capture: &str) -> String {
    if target.contains('*') {
        target.replace('*', capture)
    } else {
        target.to_string()
    }
}

fn push_normalized_candidate(candidates: &mut Vec<String>, raw: &str) -> Result<(), String> {
    let Some(candidate) = normalize_module_candidate(raw)? else {
        return Ok(());
    };
    if !candidates.iter().any(|existing| existing == &candidate) {
        candidates.push(candidate);
    }
    Ok(())
}

fn normalize_module_candidate(raw: &str) -> Result<Option<String>, String> {
    let raw = raw.trim().replace('\\', "/");
    if raw.is_empty()
        || Path::new(&raw).is_absolute()
        || raw
            .split('/')
            .next()
            .is_some_and(|part| part.len() == 2 && part.ends_with(':'))
    {
        return Ok(None);
    }

    let mut parts: Vec<&str> = Vec::new();
    for part in raw.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            if parts.pop().is_none() {
                return Ok(None);
            }
            continue;
        }
        validate_cross_platform_path_part(part)?;
        parts.push(part);
    }

    if parts.is_empty() {
        return Ok(None);
    }
    Ok(Some(parts.join("/")))
}

fn module_file_candidates(base: &str) -> Vec<String> {
    let (stem, extension) = split_module_extension(base);
    let mut candidates = Vec::new();

    match extension {
        Some("js") => {
            push_candidate(&mut candidates, &format!("{stem}.ts"));
            push_candidate(&mut candidates, &format!("{stem}.tsx"));
            push_candidate(&mut candidates, &format!("{stem}.js"));
            push_candidate(&mut candidates, &format!("{stem}.jsx"));
        }
        Some("jsx") => {
            push_candidate(&mut candidates, &format!("{stem}.tsx"));
            push_candidate(&mut candidates, &format!("{stem}.jsx"));
        }
        Some("mjs") => {
            push_candidate(&mut candidates, &format!("{stem}.mts"));
            push_candidate(&mut candidates, &format!("{stem}.mjs"));
        }
        Some("cjs") => {
            push_candidate(&mut candidates, &format!("{stem}.cts"));
            push_candidate(&mut candidates, &format!("{stem}.cjs"));
        }
        Some(_) => {
            push_candidate(&mut candidates, base);
        }
        None => {
            push_candidate(&mut candidates, base);
            for extension in [
                "ts", "tsx", "js", "jsx", "mts", "cts", "mjs", "cjs", "json", "css", "scss", "md",
                "mdx",
            ] {
                push_candidate(&mut candidates, &format!("{base}.{extension}"));
            }
            for extension in ["ts", "tsx", "js", "jsx", "json"] {
                push_candidate(&mut candidates, &format!("{base}/index.{extension}"));
            }
        }
    }

    candidates
}

fn split_module_extension(path: &str) -> (&str, Option<&str>) {
    let file_name = path.rsplit('/').next().unwrap_or(path);
    let Some(dot_index) = file_name.rfind('.') else {
        return (path, None);
    };
    if dot_index == 0 {
        return (path, None);
    }
    let stem_end = path.len() - file_name.len() + dot_index;
    (&path[..stem_end], Some(&file_name[dot_index + 1..]))
}

fn push_candidate(candidates: &mut Vec<String>, candidate: &str) {
    if !candidates.iter().any(|existing| existing == candidate) {
        candidates.push(candidate.to_string());
    }
}

fn existing_module_file(root: &Path, candidate: &str) -> Result<Option<String>, String> {
    let Some(candidate) = normalize_module_candidate(candidate)? else {
        return Ok(None);
    };
    let full_path = root.join(&candidate);
    if !full_path.is_file() {
        return Ok(None);
    }
    let root = root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve project root: {error}"))?;
    let canonical = full_path
        .canonicalize()
        .map_err(|error| format!("Failed to resolve import path: {error}"))?;
    if !canonical.starts_with(&root) || !canonical.is_file() {
        return Ok(None);
    }
    Ok(Some(candidate))
}

pub(crate) fn resolve_repo_child_path(root: &Path, normalized: &str) -> Result<PathBuf, String> {
    if normalized.is_empty() || Path::new(normalized).is_absolute() {
        return Err("Invalid file path".to_string());
    }

    let root = root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve project root: {error}"))?;
    let full_path = root.join(normalized);
    let parent = full_path
        .parent()
        .ok_or_else(|| "Selected file has no parent directory".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| format!("Failed to resolve parent directory: {error}"))?;
    if !canonical_parent.starts_with(&root) {
        return Err("File is outside the project".to_string());
    }

    Ok(full_path)
}

pub(crate) fn resolve_new_repo_child_path(
    root: &Path,
    normalized: &str,
) -> Result<PathBuf, String> {
    if normalized.is_empty() || Path::new(normalized).is_absolute() {
        return Err("Invalid file path".to_string());
    }

    let root = root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve project root: {error}"))?;
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
            return Err("File is outside the project".to_string());
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
async fn get_file_blob(
    path: String,
    file_path: String,
    ref_name: Option<String>,
) -> Result<FileContent, String> {
    blocking_command("get_file_blob", move || match ref_name.as_deref() {
        Some(ref_spec) if !ref_spec.trim().is_empty() => {
            let root = repository_root(&path)?;
            read_file_content_at_ref(&root, &file_path, ref_spec.trim())
        }
        _ => {
            let root = workspace_root(&path)?;
            read_file_content(&root, &file_path)
        }
    })
    .await
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

/// Build the command used to launch a terminal shell.
///
/// When `shell` is provided and resolves to an executable, it is launched with a
/// login flag so the user's profile is sourced. Otherwise the platform default
/// program is used, which selects the user's configured shell on Unix and
/// PowerShell on Windows when available.
fn build_terminal_command(shell: &str, cwd: &Path) -> CommandBuilder {
    let trimmed = shell.trim();
    if !trimmed.is_empty() && Path::new(trimmed).is_file() {
        let mut command = CommandBuilder::new(trimmed);
        command.cwd(cwd);
        command.env_remove("NO_COLOR");
        return command;
    }

    let mut command = CommandBuilder::new_default_prog();
    command.cwd(cwd);
    command.env_remove("NO_COLOR");
    command
}

fn resolve_terminal_cwd(root: &Path, cwd: Option<&str>) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve project root: {error}"))?;
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
    if !path_starts_with(&canonical, &root) {
        return Err("Terminal cwd must stay inside the project".to_string());
    }
    if !canonical.is_dir() {
        return Err("Terminal cwd is not a directory".to_string());
    }
    Ok(canonical)
}

/// Whether `child` is the same as or nested below `parent`.
///
/// `Path::starts_with` is case-sensitive on Windows, which can reject valid
/// project subdirectories whose drive letter or casing differs from the
/// canonicalized root. This compares components, treating the filesystem as
/// case-insensitive on Windows where path casing is not significant.
fn path_starts_with(child: &Path, parent: &Path) -> bool {
    let child_components: Vec<_> = child.components().collect();
    let parent_components: Vec<_> = parent.components().collect();
    if child_components.len() < parent_components.len() {
        return false;
    }
    for (child_part, parent_part) in child_components.iter().zip(parent_components.iter()) {
        if !components_equal(child_part, parent_part) {
            return false;
        }
    }
    true
}

#[cfg(windows)]
fn components_equal(child: &std::path::Component, parent: &std::path::Component) -> bool {
    let normalize = |component: &std::path::Component| {
        component.as_os_str().to_string_lossy().to_ascii_lowercase()
    };
    normalize(child) == normalize(parent)
}

#[cfg(not(windows))]
fn components_equal(child: &std::path::Component, parent: &std::path::Component) -> bool {
    child == parent
}

fn terminal_named_color(color: NamedColor) -> Option<&'static str> {
    match color {
        NamedColor::Black => Some("#1f2933"),
        NamedColor::Red => Some("#ef6f6c"),
        NamedColor::Green => Some("#6dd58c"),
        NamedColor::Yellow => Some("#d9b45f"),
        NamedColor::Blue => Some("#72a7ff"),
        NamedColor::Magenta => Some("#d783d7"),
        NamedColor::Cyan => Some("#00ced1"),
        NamedColor::White => Some("#d7dde2"),
        NamedColor::BrightBlack => Some("#6b7480"),
        NamedColor::BrightRed => Some("#ff8f87"),
        NamedColor::BrightGreen => Some("#88e0a1"),
        NamedColor::BrightYellow => Some("#edcc75"),
        NamedColor::BrightBlue => Some("#90bbff"),
        NamedColor::BrightMagenta => Some("#ec9dea"),
        NamedColor::BrightCyan => Some("#00ffff"),
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

fn terminal_styled_named_color(
    color: NamedColor,
    flags: Flags,
    preserve_dimmed_accent: bool,
) -> NamedColor {
    let color = if flags.contains(Flags::BOLD) {
        color.to_bright()
    } else {
        color
    };
    if flags.contains(Flags::DIM) && !preserve_dimmed_accent {
        color.to_dim()
    } else {
        color
    }
}

fn terminal_indexed_color(value: u8) -> String {
    const BASIC: [&str; 16] = [
        "#1f2933", "#ef6f6c", "#6dd58c", "#d9b45f", "#72a7ff", "#d783d7", "#00ced1", "#d7dde2",
        "#6b7480", "#ff8f87", "#88e0a1", "#edcc75", "#90bbff", "#ec9dea", "#00ffff", "#f7fafc",
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

fn terminal_foreground_color(
    color: TerminalColorValue,
    flags: Flags,
    preserve_dimmed_accent: bool,
) -> Option<String> {
    match color {
        TerminalColorValue::Named(color) => {
            let named_color = terminal_styled_named_color(color, flags, preserve_dimmed_accent);
            terminal_named_color(named_color).map(str::to_string)
        }
        TerminalColorValue::Indexed(value) => Some(terminal_indexed_color(value)),
        TerminalColorValue::Spec(rgb) => Some(format!("rgb({} {} {})", rgb.r, rgb.g, rgb.b)),
    }
}

fn terminal_cell_style(cell: &Cell) -> TerminalRunStyle {
    let flags = cell.flags;
    let preserve_dimmed_accent = flags.contains(Flags::INVERSE)
        || !matches!(cell.bg, TerminalColorValue::Named(NamedColor::Background));
    TerminalRunStyle {
        fg: terminal_foreground_color(cell.fg, flags, preserve_dimmed_accent),
        bg: terminal_color(cell.bg),
        href: cell
            .hyperlink()
            .map(|hyperlink| hyperlink.uri().to_string()),
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

fn terminal_text_is_simple_ascii(text: &str, columns: usize) -> bool {
    if text.is_empty() {
        return columns == 1;
    }

    text.len() == columns && text.bytes().all(|byte| (0x20..=0x7e).contains(&byte))
}

fn terminal_grapheme_columns(text: &str, columns: usize) -> Vec<TerminalFrameGrapheme> {
    let mut graphemes = UnicodeSegmentation::graphemes(text, true).collect::<Vec<_>>();
    if graphemes.is_empty() {
        graphemes.push(" ");
    }

    let safe_columns = columns.max(1);
    let mut remaining_columns = safe_columns;
    let grapheme_count = graphemes.len();
    let mut frame_graphemes = Vec::with_capacity(grapheme_count);

    for (index, grapheme) in graphemes.into_iter().enumerate() {
        let remaining_graphemes = grapheme_count.saturating_sub(index + 1);
        let estimated_columns = UnicodeWidthStr::width(grapheme).max(1);
        let max_columns = remaining_columns.saturating_sub(remaining_graphemes).max(1);
        let grapheme_columns = if remaining_graphemes == 0 {
            remaining_columns.max(1)
        } else {
            estimated_columns.min(max_columns).max(1)
        };
        remaining_columns = remaining_columns.saturating_sub(grapheme_columns);
        frame_graphemes.push(TerminalFrameGrapheme {
            text: grapheme.to_string(),
            columns: grapheme_columns,
        });
    }

    frame_graphemes
}

fn terminal_frame_run(text: String, style: TerminalRunStyle, columns: usize) -> TerminalFrameRun {
    let columns = columns.max(1);
    let simple_ascii = terminal_text_is_simple_ascii(&text, columns);
    let graphemes = if simple_ascii {
        None
    } else {
        Some(terminal_grapheme_columns(&text, columns))
    };

    TerminalFrameRun {
        text,
        columns,
        simple_ascii,
        graphemes,
        style,
    }
}

fn terminal_cursor_shape_str(shape: CursorShape) -> &'static str {
    match shape {
        CursorShape::Block => "block",
        CursorShape::Underline => "underline",
        CursorShape::Beam => "bar",
        CursorShape::HollowBlock => "hollowBlock",
        CursorShape::Hidden => "block",
    }
}

#[cfg(test)]
fn terminal_frame(term: &Term<TerminalEventProxy>, title: Option<&str>) -> Result<String, String> {
    terminal_frame_with_cwd(term, title, None)
}

fn terminal_frame_with_cwd(
    term: &Term<TerminalEventProxy>,
    title: Option<&str>,
    cwd: Option<&str>,
) -> Result<String, String> {
    terminal_frame_with_context_and_semantics(term, title, cwd, false, None)
}

#[cfg(test)]
fn terminal_frame_with_context(
    term: &Term<TerminalEventProxy>,
    title: Option<&str>,
    cwd: Option<&str>,
    include_scrollback_context: bool,
) -> Result<String, String> {
    terminal_frame_with_context_and_semantics(term, title, cwd, include_scrollback_context, None)
}

#[cfg(test)]
fn terminal_frame_with_semantics(
    term: &Term<TerminalEventProxy>,
    title: Option<&str>,
    cwd: Option<&str>,
    semantics: &TerminalSemanticState,
) -> Result<String, String> {
    terminal_frame_with_context_and_semantics(term, title, cwd, false, Some(semantics))
}

fn terminal_frame_with_context_and_semantics(
    term: &Term<TerminalEventProxy>,
    title: Option<&str>,
    cwd: Option<&str>,
    include_scrollback_context: bool,
    semantics: Option<&TerminalSemanticState>,
) -> Result<String, String> {
    let cursor_shape = term.cursor_style().shape;
    let grid = term.grid();
    let cols = grid.columns();
    let rows = grid.screen_lines();
    let mode = term.mode();
    let display_offset = grid.display_offset() as i32;
    let history_size = grid.history_size();
    let cursor = grid.cursor.point;
    let cursor_row = (cursor.line.0 + display_offset).max(0) as usize;
    let cursor_col = cursor.column.0.min(cols.saturating_sub(1));
    let cursor_visible =
        mode.contains(TermMode::SHOW_CURSOR) && cursor_row < rows && cursor_col < cols;
    let default_style = TerminalRunStyle {
        fg: None,
        bg: None,
        href: None,
        bold: false,
        dim: false,
        italic: false,
        underline: false,
        inverse: false,
    };
    let context_lines = if include_scrollback_context && !mode.contains(TermMode::ALT_SCREEN) {
        TERMINAL_SCROLLBACK_CONTEXT_LINES as i32
    } else {
        0
    };
    let visible_start = -display_offset;
    let visible_end = rows as i32 - display_offset - 1;
    let topmost_line = -(history_size as i32);
    let bottommost_line = rows as i32 - 1;
    let line_offset = (visible_start - context_lines).max(topmost_line);
    let line_end = (visible_end + context_lines).min(bottommost_line);
    let mut lines = Vec::with_capacity((line_end - line_offset + 1).max(0) as usize);

    for line_number in line_offset..=line_end {
        let line_index = Line(line_number);
        let mut styled_cells = Vec::new();
        let mut current_text = String::new();
        let mut current_style = default_style.clone();
        let mut current_start_col = 0;

        for col in 0..cols {
            let cell = &grid[line_index][Column(col)];
            let style = terminal_cell_style(cell);
            if col == 0 {
                current_style = style.clone();
            } else if style != current_style {
                styled_cells.push(terminal_frame_run(
                    std::mem::take(&mut current_text),
                    current_style,
                    col.saturating_sub(current_start_col),
                ));
                current_style = style.clone();
                current_start_col = col;
            }

            if cell.flags.contains(Flags::WIDE_CHAR_SPACER) {
                continue;
            }

            current_text.push(if cell.flags.contains(Flags::HIDDEN) {
                ' '
            } else {
                cell.c
            });
            if let Some(zerowidth) = cell.zerowidth() {
                current_text.extend(zerowidth);
            }
        }

        styled_cells.push(terminal_frame_run(
            current_text,
            current_style,
            cols.saturating_sub(current_start_col),
        ));
        lines.push(TerminalFrameLine {
            cells: styled_cells,
        });
    }

    let osc_cwd = semantics.and_then(|state| state.osc_cwd.as_deref());
    let frame_cwd = osc_cwd.or(cwd);
    serde_json::to_string(&TerminalFrame {
        message_type: "frame",
        title: title.map(str::to_string),
        cwd: frame_cwd.map(str::to_string),
        osc_cwd: osc_cwd.map(str::to_string),
        command_status: semantics.and_then(|state| state.command_status.clone()),
        rows,
        cols,
        display_offset: display_offset.max(0) as usize,
        line_offset,
        history_size,
        cursor_row,
        cursor_col,
        cursor_visible,
        cursor_shape: terminal_cursor_shape_str(cursor_shape),
        modes: terminal_frame_modes(*mode),
        lines,
    })
    .map_err(|error| format!("Failed to serialize terminal frame: {error}"))
}

impl TerminalSessionMetadataProbe {
    #[cfg(unix)]
    fn from_master(master: &dyn MasterPty, fallback_pid: Option<u32>) -> Self {
        Self {
            tty_fd: master.as_raw_fd().and_then(duplicate_terminal_fd),
            fallback_pid,
        }
    }

    #[cfg(not(unix))]
    fn from_pid(fallback_pid: Option<u32>) -> Self {
        Self { fallback_pid }
    }

    fn sample(&self) -> TerminalSessionMetadata {
        #[cfg(unix)]
        {
            let pid = self
                .tty_fd
                .as_ref()
                .and_then(terminal_foreground_process_id)
                .or(self.fallback_pid);
            return pid
                .and_then(read_process_terminal_metadata)
                .unwrap_or_default();
        }

        #[cfg(not(unix))]
        {
            let _ = self.fallback_pid;
            TerminalSessionMetadata::default()
        }
    }
}

#[cfg(unix)]
fn duplicate_terminal_fd(fd: RawFd) -> Option<OwnedFd> {
    let duplicated = unsafe { libc::dup(fd) };
    if duplicated < 0 {
        return None;
    }
    Some(unsafe { OwnedFd::from_raw_fd(duplicated) })
}

#[cfg(unix)]
fn terminal_foreground_process_id(fd: &OwnedFd) -> Option<u32> {
    let process_group_id = unsafe { libc::tcgetpgrp(fd.as_raw_fd()) };
    if process_group_id <= 0 {
        return None;
    }
    Some(process_group_id as u32)
}

#[cfg(unix)]
fn read_process_terminal_metadata(pid: u32) -> Option<TerminalSessionMetadata> {
    let command = read_process_command_name(pid);
    let cwd = read_process_cwd(pid);
    if command.is_none() && cwd.is_none() {
        return None;
    }
    Some(TerminalSessionMetadata { command, cwd })
}

#[cfg(not(unix))]
fn read_process_terminal_metadata(_pid: u32) -> Option<TerminalSessionMetadata> {
    None
}

#[cfg(unix)]
fn read_process_command_name(pid: u32) -> Option<String> {
    read_process_comm(pid).or_else(|| read_process_argv0_name(pid))
}

#[cfg(unix)]
fn read_process_comm(pid: u32) -> Option<String> {
    fs::read_to_string(format!("/proc/{pid}/comm"))
        .ok()
        .and_then(|value| terminal_trimmed_text(&value).map(str::to_string))
}

#[cfg(unix)]
fn read_process_argv0_name(pid: u32) -> Option<String> {
    let bytes = fs::read(format!("/proc/{pid}/cmdline")).ok()?;
    let argv0 = bytes
        .split(|byte| *byte == 0)
        .find(|part| !part.is_empty())?;
    let argv0 = String::from_utf8_lossy(argv0);
    Path::new(argv0.as_ref())
        .file_name()
        .and_then(terminal_os_label)
}

#[cfg(unix)]
fn read_process_cwd(pid: u32) -> Option<String> {
    fs::read_link(format!("/proc/{pid}/cwd"))
        .ok()
        .map(|path| path.to_string_lossy().to_string())
}

fn terminal_trimmed_text(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed)
}

fn terminal_os_label(value: &std::ffi::OsStr) -> Option<String> {
    let value = value.to_string_lossy();
    terminal_trimmed_text(value.as_ref()).map(str::to_string)
}

fn terminal_root_label(root: &Path) -> String {
    root.file_name()
        .and_then(terminal_os_label)
        .unwrap_or_else(|| root.to_string_lossy().to_string())
}

fn terminal_cwd_label(root: &Path, cwd: &str) -> String {
    let cwd_path = Path::new(cwd);
    if let Ok(relative) = cwd_path.strip_prefix(root) {
        let relative_label = relative.to_string_lossy();
        if !relative_label.is_empty() {
            return relative_label.to_string();
        }
        return terminal_root_label(root);
    }

    cwd_path
        .file_name()
        .and_then(terminal_os_label)
        .unwrap_or_else(|| cwd.to_string())
}

fn terminal_display_title(
    root: &Path,
    osc_title: Option<&str>,
    metadata: &TerminalSessionMetadata,
) -> Option<String> {
    if let Some(osc_title) = osc_title.and_then(terminal_trimmed_text) {
        return Some(osc_title.to_string());
    }

    let command = metadata.command.as_deref().and_then(terminal_trimmed_text);
    let cwd = metadata.cwd.as_deref().and_then(terminal_trimmed_text);
    match (command, cwd) {
        (Some(command), Some(cwd)) => {
            Some(format!("{command} @ {}", terminal_cwd_label(root, cwd)))
        }
        (Some(command), None) => Some(command.to_string()),
        (None, Some(cwd)) => Some(terminal_cwd_label(root, cwd)),
        (None, None) => None,
    }
}

fn run_terminal_metadata_observer(
    probe: TerminalSessionMetadataProbe,
    ui_event_tx: mpsc::Sender<TerminalUiEvent>,
) {
    let mut last_metadata = TerminalSessionMetadata::default();
    loop {
        let next_metadata = probe.sample();
        if next_metadata != last_metadata {
            last_metadata = next_metadata.clone();
            if ui_event_tx
                .send(TerminalUiEvent::SessionMetadata(next_metadata))
                .is_err()
            {
                return;
            }
        }
        thread::sleep(TERMINAL_SESSION_METADATA_POLL_INTERVAL);
    }
}

fn drain_terminal_ui_events(
    ui_event_rx: &mpsc::Receiver<TerminalUiEvent>,
    title: &mut Option<String>,
    metadata: &mut TerminalSessionMetadata,
) -> (bool, bool) {
    let mut changed = false;
    let mut bell = false;
    while let Ok(event) = ui_event_rx.try_recv() {
        match event {
            TerminalUiEvent::Title(next_title) => {
                if *title != next_title {
                    *title = next_title;
                    changed = true;
                }
            }
            TerminalUiEvent::SessionMetadata(next_metadata) => {
                if *metadata != next_metadata {
                    *metadata = next_metadata;
                    changed = true;
                }
            }
            TerminalUiEvent::Bell => {
                bell = true;
            }
        }
    }
    (changed, bell)
}

/// Spawn a terminal session with default options.
///
/// Kept as a thin wrapper so existing callers and tests stay readable while
/// the options-aware variant carries the configuration.
#[allow(dead_code)]
fn spawn_terminal_session(
    state: &TerminalState,
    root: &Path,
    cwd: Option<&str>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<TerminalSessionInfo, String> {
    spawn_terminal_session_with_options(
        state,
        root,
        cwd,
        cols,
        rows,
        TerminalSpawnOptions::default(),
    )
}

fn spawn_terminal_session_with_options(
    state: &TerminalState,
    root: &Path,
    cwd: Option<&str>,
    cols: Option<u16>,
    rows: Option<u16>,
    options: TerminalSpawnOptions,
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
    let mut command = build_terminal_command(&options.shell, &cwd);
    command.env("TERM", "xterm-256color");
    for (key, value) in options.env {
        if is_valid_terminal_env_key(&key) {
            command.env(key, value);
        }
    }

    let mut child = slave
        .spawn_command(command)
        .map_err(|error| format!("Failed to spawn terminal shell: {error}"))?;
    let pid = child.process_id();
    let killer = child.clone_killer();
    drop(slave);

    #[cfg(unix)]
    let metadata_probe = TerminalSessionMetadataProbe::from_master(master.as_ref(), pid);
    #[cfg(not(unix))]
    let metadata_probe = TerminalSessionMetadataProbe::from_pid(pid);
    let initial_terminal_metadata = metadata_probe.sample();

    let mut reader = master
        .try_clone_reader()
        .map_err(|error| format!("Failed to open terminal reader: {error}"))?;
    let writer = master
        .take_writer()
        .map_err(|error| format!("Failed to open terminal writer: {error}"))?;
    let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>();
    let (resize_tx, resize_rx) = mpsc::channel::<PtySize>();
    let (parser_tx, parser_rx) = mpsc::channel::<TerminalParserEvent>();
    let (ui_event_tx, ui_event_rx) = mpsc::channel::<TerminalUiEvent>();
    let visual_bell = options.visual_bell;
    let terminal_config = TerminalConfig {
        scrolling_history: options.scrollback_lines,
        default_cursor_style: options.cursor_style.to_alacritty(),
        ..TerminalConfig::default()
    };
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
    thread::spawn(move || {
        while let Ok(size) = resize_rx.recv() {
            if master.resize(size).is_err() {
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
                resize_tx,
                ws_shutdown_tx,
                killer: Mutex::new(killer),
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
    let metadata_ui_event_tx = ui_event_tx.clone();
    thread::spawn(move || {
        run_terminal_metadata_observer(metadata_probe, metadata_ui_event_tx);
    });

    let title_root = root.to_path_buf();
    thread::spawn(move || {
        let initial_cols = cols.unwrap_or(80).max(1) as usize;
        let initial_rows = rows.unwrap_or(24).max(1) as usize;
        let mut term = Term::new(
            terminal_config.clone(),
            &TermSize::new(initial_cols, initial_rows),
            TerminalEventProxy {
                input_tx: parser_input_tx,
                ui_event_tx,
            },
        );
        let mut processor = TerminalProcessor::<TerminalSyncHandler>::new();
        let mut title: Option<String> = None;
        let mut metadata = initial_terminal_metadata;
        let mut semantics = TerminalSemanticState::default();
        let initial_display_title =
            terminal_display_title(&title_root, title.as_deref(), &metadata);
        if let Ok(frame) = terminal_frame_with_cwd(
            &term,
            initial_display_title.as_deref(),
            metadata.cwd.as_deref(),
        ) {
            let _ = reader_output_tx.send(TerminalWsEvent::Frame(frame));
        }

        let apply_event = |event: TerminalParserEvent,
                           term: &mut Term<TerminalEventProxy>,
                           processor: &mut TerminalProcessor<TerminalSyncHandler>,
                           semantics: &mut TerminalSemanticState|
         -> bool {
            match event {
                TerminalParserEvent::Output(bytes) => {
                    semantics.advance_output(&bytes);
                    processor.advance(term, &bytes);
                    false
                }
                TerminalParserEvent::Resize(cols, rows) => {
                    term.resize(TermSize::new(cols.max(1) as usize, rows.max(1) as usize));
                    false
                }
                // Redraw only needs the current frame re-emitted below.
                TerminalParserEvent::Redraw => false,
                TerminalParserEvent::Scroll(delta) => {
                    term.scroll_display(Scroll::Delta(delta));
                    true
                }
            }
        };

        loop {
            let mut terminal_changed = false;
            let mut include_scrollback_context = false;
            match parser_rx.recv_timeout(TERMINAL_SESSION_METADATA_POLL_INTERVAL) {
                Ok(event) => {
                    terminal_changed = true;
                    include_scrollback_context |=
                        apply_event(event, &mut term, &mut processor, &mut semantics);
                    while let Ok(event) = parser_rx.try_recv() {
                        include_scrollback_context |=
                            apply_event(event, &mut term, &mut processor, &mut semantics);
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
            let (ui_changed, bell_fired) =
                drain_terminal_ui_events(&ui_event_rx, &mut title, &mut metadata);
            if bell_fired && visual_bell {
                if reader_output_tx.send(TerminalWsEvent::Bell).is_err() {
                    break;
                }
            }
            if !terminal_changed && !ui_changed {
                continue;
            }

            let display_metadata = TerminalSessionMetadata {
                command: metadata.command.clone(),
                cwd: semantics.osc_cwd.clone().or_else(|| metadata.cwd.clone()),
            };
            let display_title =
                terminal_display_title(&title_root, title.as_deref(), &display_metadata);
            include_scrollback_context |= term.grid().display_offset() > 0;
            match terminal_frame_with_context_and_semantics(
                &term,
                display_title.as_deref(),
                metadata.cwd.as_deref(),
                include_scrollback_context,
                Some(&semantics),
            ) {
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
        run_terminal_ws(
            listener,
            ws_input_tx,
            ws_output_rx,
            ws_shutdown_rx,
            parser_tx.clone(),
        );
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

fn is_valid_terminal_env_key(key: &str) -> bool {
    !key.is_empty() && !key.contains('=') && !key.contains('\0')
}

fn run_terminal_ws(
    listener: TcpListener,
    input_tx: mpsc::Sender<Vec<u8>>,
    output_rx: mpsc::Receiver<TerminalWsEvent>,
    shutdown_rx: mpsc::Receiver<()>,
    redraw_tx: mpsc::Sender<TerminalParserEvent>,
) {
    let sleep_duration = Duration::from_millis(TERMINAL_WS_IDLE_SLEEP_MS);
    let mut pending_output = VecDeque::<TerminalWsEvent>::new();

    // Outer loop accepts successive WebSocket connections so a terminal can
    // disconnect (e.g. the panel is hidden/unmounted) and reconnect to the
    // same live PTY without losing its process or screen state.
    loop {
        if shutdown_rx.try_recv().is_ok() {
            return;
        }
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
                        Err(_) => continue,
                    }
                }
                Err(error) if error.kind() == ErrorKind::WouldBlock => {
                    thread::sleep(sleep_duration);
                }
                Err(_) => continue,
            }
        };

        // A fresh connection should render the current terminal contents, not
        // a blank screen; ask the parser thread to re-emit the latest frame.
        let _ = redraw_tx.send(TerminalParserEvent::Redraw);

        let disconnected = run_terminal_ws_connection(
            &mut websocket,
            &input_tx,
            &output_rx,
            &shutdown_rx,
            &mut pending_output,
            sleep_duration,
        );

        match disconnected {
            TerminalWsDisconnect::Reconnect => {
                let _ = websocket.close(None);
                continue;
            }
            TerminalWsDisconnect::Exit => {
                let _ = websocket.close(None);
                return;
            }
        }
    }
}

enum TerminalWsDisconnect {
    /// Client disconnected; accept a new connection to keep the session alive.
    Reconnect,
    /// PTY exited or the session was killed; stop serving.
    Exit,
}

fn run_terminal_ws_connection(
    websocket: &mut WebSocket<TcpStream>,
    input_tx: &mpsc::Sender<Vec<u8>>,
    output_rx: &mpsc::Receiver<TerminalWsEvent>,
    shutdown_rx: &mpsc::Receiver<()>,
    pending_output: &mut VecDeque<TerminalWsEvent>,
    sleep_duration: Duration,
) -> TerminalWsDisconnect {
    loop {
        if shutdown_rx.try_recv().is_ok() {
            return TerminalWsDisconnect::Exit;
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
                Ok(Message::Close(_)) => return TerminalWsDisconnect::Reconnect,
                Ok(Message::Ping(payload)) => {
                    did_work = true;
                    let _ = websocket.send(Message::Pong(payload));
                }
                Ok(Message::Pong(_)) | Ok(Message::Frame(_)) => {
                    did_work = true;
                }
                Err(WsError::Io(error)) if error.kind() == ErrorKind::WouldBlock => break,
                Err(WsError::ConnectionClosed) | Err(WsError::AlreadyClosed) => {
                    return TerminalWsDisconnect::Reconnect;
                }
                Err(_) => return TerminalWsDisconnect::Reconnect,
            }
        }

        while let Ok(event) = output_rx.try_recv() {
            did_work = true;
            let is_exit = matches!(event, TerminalWsEvent::Close(_));
            pending_output.push_back(event);
            while pending_output.len() > TERMINAL_WS_PENDING_OUTPUT_LIMIT {
                pending_output.pop_front();
            }
            if is_exit {
                break;
            }
        }

        let mut sent_output_count = 0;
        while sent_output_count < TERMINAL_WS_OUTPUT_BURST_LIMIT {
            let Some(event) = pending_output.pop_front() else {
                break;
            };
            match write_terminal_ws_event(websocket, &event) {
                Ok(true) => return TerminalWsDisconnect::Exit,
                Ok(false) => {
                    did_work = true;
                    sent_output_count += 1;
                }
                Err(WsError::Io(error)) if error.kind() == ErrorKind::WouldBlock => {
                    pending_output.push_front(event);
                    break;
                }
                Err(WsError::ConnectionClosed) | Err(WsError::AlreadyClosed) => {
                    return TerminalWsDisconnect::Reconnect;
                }
                Err(_) => return TerminalWsDisconnect::Reconnect,
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
        TerminalWsEvent::Bell => {
            websocket.send(Message::Text(r#"{"type":"bell"}"#.to_string()))?;
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
    fn terminal_frame_renders_scrollback_history_when_scrolled() {
        let (input_tx, _input_rx) = mpsc::channel::<Vec<u8>>();
        // 4 visible rows; history grows as rows scroll off.
        let mut term = Term::new(
            TerminalConfig::default(),
            &TermSize::new(20, 4),
            test_terminal_event_proxy(input_tx),
        );
        let mut processor = TerminalProcessor::<TerminalSyncHandler>::new();

        // Print 8 distinct markers, one per line. Only the last few remain on
        // the visible screen; the earlier ones move into scrollback history.
        for n in 1..=8 {
            processor.advance(&mut term, format!("MK{n}\r\n").as_bytes());
        }

        let visible_frame: serde_json::Value =
            serde_json::from_str(&terminal_frame(&term, None).expect("terminal frame"))
                .expect("visible frame json");
        let visible_text = terminal_frame_text(&visible_frame);
        assert!(
            visible_text.contains("MK8") && !visible_text.contains("MK1"),
            "only the last rows should be on the visible screen: {visible_text:?}"
        );

        // Scroll all the way to the top of scrollback; MK1 should reappear in
        // the rendered frame, proving history is exposed when scrolled.
        term.scroll_display(Scroll::Top);
        let scrolled_frame: serde_json::Value =
            serde_json::from_str(&terminal_frame(&term, None).expect("terminal frame"))
                .expect("scrolled frame json");
        let scrolled_text = terminal_frame_text(&scrolled_frame);
        assert!(
            scrolled_text.contains("MK1"),
            "scrolling up should reveal scrollback history: {scrolled_text:?}"
        );
        // Cursor should be hidden while viewing history (it sits below the
        // scrolled viewport).
        assert_eq!(scrolled_frame["cursorVisible"], false);
    }

    #[test]
    fn terminal_frame_can_include_scrollback_context_for_local_scroll_preview() {
        let (input_tx, _input_rx) = mpsc::channel::<Vec<u8>>();
        let mut term = Term::new(
            TerminalConfig::default(),
            &TermSize::new(20, 4),
            test_terminal_event_proxy(input_tx),
        );
        let mut processor = TerminalProcessor::<TerminalSyncHandler>::new();

        for n in 1..=12 {
            processor.advance(&mut term, format!("CTX{n}\r\n").as_bytes());
        }

        term.scroll_display(Scroll::Delta(3));
        let frame: serde_json::Value = serde_json::from_str(
            &terminal_frame_with_context(&term, None, None, true).expect("terminal frame"),
        )
        .expect("scrolled context frame json");

        assert_eq!(frame["rows"], 4);
        assert_eq!(frame["displayOffset"], 3);
        assert!(
            frame["historySize"].as_u64().expect("history size") >= 3,
            "history size should expose the local scroll clamp"
        );
        assert!(
            frame["lineOffset"].as_i64().expect("line offset") < -3,
            "line offset should start before the visible scrolled viewport"
        );
        assert!(
            frame["lines"].as_array().expect("lines").len() > 4,
            "scrollback context should include cached rows outside the visible viewport"
        );
    }

    #[test]
    fn terminal_frame_preserves_full_row_width_for_tui_backgrounds() {
        let (input_tx, _input_rx) = mpsc::channel::<Vec<u8>>();
        let mut term = Term::new(
            TerminalConfig::default(),
            &TermSize::new(10, 3),
            test_terminal_event_proxy(input_tx),
        );
        let mut processor = TerminalProcessor::<TerminalSyncHandler>::new();

        processor.advance(&mut term, b"\x1b[48;5;57mHi");

        let frame: serde_json::Value =
            serde_json::from_str(&terminal_frame(&term, None).expect("terminal frame"))
                .expect("frame json");
        let first_line_text = frame["lines"][0]["cells"]
            .as_array()
            .expect("first line cells")
            .iter()
            .filter_map(|cell| cell["text"].as_str())
            .collect::<String>();

        assert_eq!(first_line_text.chars().count(), 10);
        assert!(
            first_line_text.starts_with("Hi"),
            "full-width terminal rows should preserve visible text: {first_line_text:?}"
        );
    }

    #[test]
    fn terminal_frame_preserves_hidden_cells_as_blank_columns() {
        let (input_tx, _input_rx) = mpsc::channel::<Vec<u8>>();
        let mut term = Term::new(
            TerminalConfig::default(),
            &TermSize::new(5, 2),
            test_terminal_event_proxy(input_tx),
        );
        let mut processor = TerminalProcessor::<TerminalSyncHandler>::new();

        processor.advance(&mut term, b"A\x1b[8mB\x1b[28mC");

        let frame: serde_json::Value =
            serde_json::from_str(&terminal_frame(&term, None).expect("terminal frame"))
                .expect("frame json");
        let first_line_text = frame["lines"][0]["cells"]
            .as_array()
            .expect("first line cells")
            .iter()
            .filter_map(|cell| cell["text"].as_str())
            .collect::<String>();

        assert_eq!(first_line_text.chars().count(), 5);
        assert!(
            first_line_text.starts_with("A C"),
            "hidden characters should occupy blank terminal columns: {first_line_text:?}"
        );
    }

    #[test]
    fn terminal_frame_serializes_run_width_metadata() {
        let (input_tx, _input_rx) = mpsc::channel::<Vec<u8>>();
        let mut term = Term::new(
            TerminalConfig::default(),
            &TermSize::new(6, 2),
            test_terminal_event_proxy(input_tx),
        );
        let mut processor = TerminalProcessor::<TerminalSyncHandler>::new();

        processor.advance(&mut term, "A界e\u{301}".as_bytes());

        let frame: serde_json::Value =
            serde_json::from_str(&terminal_frame(&term, None).expect("terminal frame"))
                .expect("frame json");
        let first_run = &frame["lines"][0]["cells"][0];
        let graphemes = first_run["graphemes"]
            .as_array()
            .expect("non-ascii run should expose grapheme metadata");

        assert_eq!(first_run["columns"], 6);
        assert_eq!(first_run["simpleAscii"], false);
        assert!(
            graphemes
                .iter()
                .any(|grapheme| grapheme["text"] == "界" && grapheme["columns"] == 2),
            "wide grapheme metadata should be serialized: {graphemes:?}"
        );
    }

    #[test]
    fn terminal_frame_skips_grapheme_metadata_for_simple_ascii_runs() {
        let (input_tx, _input_rx) = mpsc::channel::<Vec<u8>>();
        let mut term = Term::new(
            TerminalConfig::default(),
            &TermSize::new(6, 2),
            test_terminal_event_proxy(input_tx),
        );
        let mut processor = TerminalProcessor::<TerminalSyncHandler>::new();

        processor.advance(&mut term, b"Hi");

        let frame: serde_json::Value =
            serde_json::from_str(&terminal_frame(&term, None).expect("terminal frame"))
                .expect("frame json");
        let first_run = &frame["lines"][0]["cells"][0];

        assert_eq!(first_run["columns"], 6);
        assert_eq!(first_run["simpleAscii"], true);
        assert_eq!(first_run.get("graphemes"), None);
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
        let mut metadata = TerminalSessionMetadata::default();

        processor.advance(&mut term, b"\x1b]0;View Title Protocol\x07");
        let _ = drain_terminal_ui_events(&ui_event_rx, &mut title, &mut metadata);
        let display_title =
            terminal_display_title(Path::new("/tmp/view"), title.as_deref(), &metadata);
        let frame: serde_json::Value = serde_json::from_str(
            &terminal_frame(&term, display_title.as_deref()).expect("terminal frame"),
        )
        .expect("frame json");

        assert_eq!(frame["title"], "View Title Protocol");
    }

    #[test]
    fn terminal_frame_exposes_current_working_directory() {
        let (input_tx, _input_rx) = mpsc::channel::<Vec<u8>>();
        let term = Term::new(
            TerminalConfig::default(),
            &TermSize::new(20, 6),
            test_terminal_event_proxy(input_tx),
        );

        let frame: serde_json::Value = serde_json::from_str(
            &terminal_frame_with_cwd(&term, None, Some("/tmp/view/packages/app"))
                .expect("terminal frame"),
        )
        .expect("frame json");

        assert_eq!(frame["cwd"], "/tmp/view/packages/app");
    }

    #[test]
    fn terminal_osc_semantics_tracks_command_boundaries() {
        let mut semantics = TerminalSemanticState::default();

        semantics.advance_output(b"\x1b]133;C\x07");
        assert_eq!(
            semantics.command_status,
            Some(TerminalCommandStatus {
                phase: TerminalCommandPhase::Running,
                exit_code: None,
            })
        );

        semantics.advance_output(b"\x1b]133;D;2\x07");
        assert_eq!(
            semantics.command_status,
            Some(TerminalCommandStatus {
                phase: TerminalCommandPhase::Finished,
                exit_code: Some(2),
            })
        );
    }

    #[test]
    fn terminal_osc_semantics_tracks_current_working_directory() {
        let mut semantics = TerminalSemanticState::default();

        semantics.advance_output(b"\x1b]7;file://host/tmp/view/packages%20app\x07");

        assert_eq!(semantics.osc_cwd.as_deref(), Some("/tmp/view/packages app"));
    }

    #[test]
    fn terminal_frame_exposes_osc_command_status_and_cwd() {
        let (input_tx, _input_rx) = mpsc::channel::<Vec<u8>>();
        let term = Term::new(
            TerminalConfig::default(),
            &TermSize::new(20, 6),
            test_terminal_event_proxy(input_tx),
        );
        let mut semantics = TerminalSemanticState::default();
        semantics.advance_output(b"\x1b]7;file://host/tmp/view\x07\x1b]133;C\x07");

        let frame: serde_json::Value = serde_json::from_str(
            &terminal_frame_with_semantics(&term, None, Some("/tmp/fallback"), &semantics)
                .expect("terminal frame"),
        )
        .expect("frame json");

        assert_eq!(frame["cwd"], "/tmp/view");
        assert_eq!(frame["oscCwd"], "/tmp/view");
        assert_eq!(frame["commandStatus"]["phase"], "running");
        assert_eq!(frame["commandStatus"]["exitCode"], serde_json::Value::Null);
    }

    #[test]
    fn terminal_frame_maps_bold_default_foreground_to_bright() {
        let (input_tx, _input_rx) = mpsc::channel::<Vec<u8>>();
        let mut term = Term::new(
            TerminalConfig::default(),
            &TermSize::new(10, 2),
            test_terminal_event_proxy(input_tx),
        );
        let mut processor = TerminalProcessor::<TerminalSyncHandler>::new();

        processor.advance(&mut term, b"\x1b[1mB");

        let frame: serde_json::Value =
            serde_json::from_str(&terminal_frame(&term, None).expect("terminal frame"))
                .expect("frame json");
        let first_run = &frame["lines"][0]["cells"][0];

        assert_eq!(first_run["bold"], true);
        assert_eq!(first_run["fg"], "#f7fafc");
    }

    #[test]
    fn terminal_frame_maps_bold_basic_ansi_foreground_to_bright() {
        let (input_tx, _input_rx) = mpsc::channel::<Vec<u8>>();
        let mut term = Term::new(
            TerminalConfig::default(),
            &TermSize::new(10, 2),
            test_terminal_event_proxy(input_tx),
        );
        let mut processor = TerminalProcessor::<TerminalSyncHandler>::new();

        processor.advance(&mut term, b"\x1b[1;31mR");

        let frame: serde_json::Value =
            serde_json::from_str(&terminal_frame(&term, None).expect("terminal frame"))
                .expect("frame json");
        let first_run = &frame["lines"][0]["cells"][0];

        assert_eq!(first_run["bold"], true);
        assert_eq!(first_run["fg"], "#ff8f87");
    }

    #[test]
    fn terminal_frame_uses_bright_cyan_for_basic_ansi_cyan() {
        let (input_tx, _input_rx) = mpsc::channel::<Vec<u8>>();
        let mut term = Term::new(
            TerminalConfig::default(),
            &TermSize::new(10, 2),
            test_terminal_event_proxy(input_tx),
        );
        let mut processor = TerminalProcessor::<TerminalSyncHandler>::new();

        processor.advance(&mut term, b"\x1b[36mC");

        let frame: serde_json::Value =
            serde_json::from_str(&terminal_frame(&term, None).expect("terminal frame"))
                .expect("frame json");
        let first_run = &frame["lines"][0]["cells"][0];

        assert_eq!(first_run["fg"], "#00ced1");
    }

    #[test]
    fn terminal_frame_uses_bright_cyan_for_indexed_ansi_cyan() {
        let (input_tx, _input_rx) = mpsc::channel::<Vec<u8>>();
        let mut term = Term::new(
            TerminalConfig::default(),
            &TermSize::new(10, 2),
            test_terminal_event_proxy(input_tx),
        );
        let mut processor = TerminalProcessor::<TerminalSyncHandler>::new();

        processor.advance(&mut term, b"\x1b[38;5;6mC");

        let frame: serde_json::Value =
            serde_json::from_str(&terminal_frame(&term, None).expect("terminal frame"))
                .expect("frame json");
        let first_run = &frame["lines"][0]["cells"][0];

        assert_eq!(first_run["fg"], "#00ced1");
    }

    #[test]
    fn terminal_frame_maps_dim_default_foreground_to_dim_color() {
        let (input_tx, _input_rx) = mpsc::channel::<Vec<u8>>();
        let mut term = Term::new(
            TerminalConfig::default(),
            &TermSize::new(10, 2),
            test_terminal_event_proxy(input_tx),
        );
        let mut processor = TerminalProcessor::<TerminalSyncHandler>::new();

        processor.advance(&mut term, b"\x1b[2mD");

        let frame: serde_json::Value =
            serde_json::from_str(&terminal_frame(&term, None).expect("terminal frame"))
                .expect("frame json");
        let first_run = &frame["lines"][0]["cells"][0];

        assert_eq!(first_run["dim"], true);
        assert_eq!(first_run["fg"], "#9ca3af");
    }

    #[test]
    fn terminal_frame_maps_dim_basic_ansi_foreground_to_dim_color() {
        let (input_tx, _input_rx) = mpsc::channel::<Vec<u8>>();
        let mut term = Term::new(
            TerminalConfig::default(),
            &TermSize::new(10, 2),
            test_terminal_event_proxy(input_tx),
        );
        let mut processor = TerminalProcessor::<TerminalSyncHandler>::new();

        processor.advance(&mut term, b"\x1b[2;36mC");

        let frame: serde_json::Value =
            serde_json::from_str(&terminal_frame(&term, None).expect("terminal frame"))
                .expect("frame json");
        let first_run = &frame["lines"][0]["cells"][0];

        assert_eq!(first_run["dim"], true);
        assert_eq!(first_run["fg"], "#4b989b");
    }

    #[test]
    fn terminal_frame_preserves_dim_ansi_foreground_on_highlight_background() {
        let (input_tx, _input_rx) = mpsc::channel::<Vec<u8>>();
        let mut term = Term::new(
            TerminalConfig::default(),
            &TermSize::new(10, 2),
            test_terminal_event_proxy(input_tx),
        );
        let mut processor = TerminalProcessor::<TerminalSyncHandler>::new();

        processor.advance(&mut term, b"\x1b[2;36;48;5;235m|");

        let frame: serde_json::Value =
            serde_json::from_str(&terminal_frame(&term, None).expect("terminal frame"))
                .expect("frame json");
        let first_run = &frame["lines"][0]["cells"][0];

        assert_eq!(first_run["dim"], true);
        assert_eq!(first_run["fg"], "#00ced1");
        assert_eq!(first_run["bg"], "rgb(38 38 38)");
    }

    #[test]
    fn terminal_frame_preserves_dim_ansi_foreground_on_inverse_highlight() {
        let (input_tx, _input_rx) = mpsc::channel::<Vec<u8>>();
        let mut term = Term::new(
            TerminalConfig::default(),
            &TermSize::new(10, 2),
            test_terminal_event_proxy(input_tx),
        );
        let mut processor = TerminalProcessor::<TerminalSyncHandler>::new();

        processor.advance(&mut term, b"\x1b[2;36;7m|");

        let frame: serde_json::Value =
            serde_json::from_str(&terminal_frame(&term, None).expect("terminal frame"))
                .expect("frame json");
        let first_run = &frame["lines"][0]["cells"][0];

        assert_eq!(first_run["dim"], true);
        assert_eq!(first_run["inverse"], true);
        assert_eq!(first_run["fg"], "#00ced1");
    }

    #[test]
    fn terminal_frame_exposes_osc8_hyperlinks() {
        let (input_tx, _input_rx) = mpsc::channel::<Vec<u8>>();
        let mut term = Term::new(
            TerminalConfig::default(),
            &TermSize::new(40, 4),
            test_terminal_event_proxy(input_tx),
        );
        let mut processor = TerminalProcessor::<TerminalSyncHandler>::new();

        processor.advance(
            &mut term,
            b"\x1b]8;;https://example.com/docs\x07docs\x1b]8;;\x07 plain",
        );

        let frame: serde_json::Value =
            serde_json::from_str(&terminal_frame(&term, None).expect("terminal frame"))
                .expect("frame json");
        let cells = frame["lines"][0]["cells"]
            .as_array()
            .expect("first terminal line cells");
        let linked_run = cells
            .iter()
            .find(|run| run["text"] == "docs")
            .expect("linked run");
        let plain_run = cells
            .iter()
            .find(|run| {
                run["text"]
                    .as_str()
                    .is_some_and(|text| text.contains("plain"))
            })
            .expect("plain run after hyperlink reset");

        assert_eq!(linked_run["href"], "https://example.com/docs");
        assert_eq!(plain_run["href"], serde_json::Value::Null);
    }

    #[test]
    fn detect_terminal_shells_returns_unique_paths() {
        let shells = detect_terminal_shells();

        // Paths must be unique; the same executable must not appear twice even
        // when probed under multiple aliases (e.g. pwsh.exe / powershell.exe).
        let mut seen: Vec<String> = Vec::new();
        for shell in &shells {
            assert!(
                !seen
                    .iter()
                    .any(|seen_path| paths_equal_ci(seen_path, &shell.path)),
                "duplicate shell path detected: {}",
                shell.path,
            );
            seen.push(shell.path.clone());
        }

        // sh is almost always available on the test host; if present it should
        // carry a non-empty label.
        if let Some(sh) = shells.iter().find(|shell| {
            Path::new(&shell.path)
                .file_stem()
                .and_then(|name| name.to_str())
                .map(|name| name.eq_ignore_ascii_case("sh"))
                .unwrap_or(false)
        }) {
            assert!(!sh.label.is_empty(), "shell label should not be empty");
        }
    }

    #[test]
    fn external_url_validation_allows_safe_terminal_link_schemes() {
        assert_eq!(
            validated_external_url("https://example.com/docs"),
            Ok("https://example.com/docs")
        );
        assert_eq!(
            validated_external_url(" file:///tmp/view.txt "),
            Ok("file:///tmp/view.txt")
        );
        assert_eq!(
            validated_external_url("mailto:dev@example.com"),
            Ok("mailto:dev@example.com")
        );
    }

    #[test]
    fn external_url_validation_rejects_unsafe_terminal_link_schemes() {
        assert!(validated_external_url("javascript:alert(1)").is_err());
        assert!(validated_external_url("https://example.com/\nnext").is_err());
        assert!(validated_external_url("").is_err());
    }

    #[test]
    fn terminal_frame_exposes_configured_cursor_shape() {
        let (input_tx, _input_rx) = mpsc::channel::<Vec<u8>>();
        let (ui_event_tx, _ui_event_rx) = mpsc::channel::<TerminalUiEvent>();
        let term = Term::new(
            TerminalConfig {
                default_cursor_style: CursorStyle {
                    shape: CursorShape::Beam,
                    blinking: false,
                },
                ..TerminalConfig::default()
            },
            &TermSize::new(20, 6),
            TerminalEventProxy {
                input_tx,
                ui_event_tx,
            },
        );

        let frame: serde_json::Value =
            serde_json::from_str(&terminal_frame(&term, None).expect("terminal frame"))
                .expect("frame json");
        assert_eq!(frame["cursorShape"], "bar");
    }

    #[test]
    fn terminal_command_removes_host_no_color_env() {
        let repo = create_basic_repo();
        let original_no_color = std::env::var_os("NO_COLOR");
        std::env::set_var("NO_COLOR", "1");

        let command = build_terminal_command("", repo.as_path());

        if let Some(value) = original_no_color {
            std::env::set_var("NO_COLOR", value);
        } else {
            std::env::remove_var("NO_COLOR");
        }
        assert_eq!(command.get_env("NO_COLOR"), None);
    }

    #[test]
    fn terminal_env_keys_reject_shell_invalid_names() {
        assert!(is_valid_terminal_env_key("VIEW_ENV"));
        assert!(!is_valid_terminal_env_key(""));
        assert!(!is_valid_terminal_env_key("BAD=NAME"));
        assert!(!is_valid_terminal_env_key("BAD\0NAME"));
    }

    #[test]
    fn terminal_bell_event_is_forwarded_to_websocket() {
        let repo = create_basic_repo();
        let state = TerminalState::default();
        let options = TerminalSpawnOptions {
            visual_bell: true,
            ..TerminalSpawnOptions::default()
        };
        let session =
            spawn_terminal_session_with_options(&state, &repo, None, Some(80), Some(12), options)
                .expect("spawn terminal session");
        let mut websocket = connect_terminal_websocket(&session);

        // Ring the bell; the parser thread should forward a bell message to the
        // connected websocket client.
        websocket
            .send(Message::Text("printf '\\a'\r".to_string()))
            .expect("send bell");

        let deadline = Instant::now() + Duration::from_secs(5);
        let mut saw_bell = false;
        while Instant::now() < deadline && !saw_bell {
            match websocket.read() {
                Ok(Message::Text(text)) => {
                    let Ok(frame) = serde_json::from_str::<serde_json::Value>(&text) else {
                        continue;
                    };
                    if frame["type"] == "bell" {
                        saw_bell = true;
                    }
                }
                Ok(_) => {}
                Err(WsError::Io(error))
                    if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
                Err(error) => panic!("terminal websocket read failed: {error}"),
            }
        }

        assert!(saw_bell, "bell should be forwarded to the websocket client");
        let _ = websocket.close(None);
        let _ = kill_terminal_session(&state, &session.id);
        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn terminal_display_title_prefers_osc_title_over_live_process_metadata() {
        let metadata = TerminalSessionMetadata {
            command: Some("codex".to_string()),
            cwd: Some("/root/projects/view/src/components".to_string()),
        };

        assert_eq!(
            terminal_display_title(
                Path::new("/root/projects/view"),
                Some("shell title"),
                &metadata,
            ),
            Some("shell title".to_string())
        );
    }

    #[test]
    fn terminal_display_title_falls_back_to_live_process_metadata_after_reset() {
        let metadata = TerminalSessionMetadata {
            command: Some("codex".to_string()),
            cwd: Some("/root/projects/view/src/components".to_string()),
        };

        assert_eq!(
            terminal_display_title(Path::new("/root/projects/view"), None, &metadata,),
            Some("codex @ src/components".to_string())
        );
    }

    #[test]
    fn terminal_frame_omits_wide_char_spacer_cells_from_serialized_text() {
        let (input_tx, _input_rx) = mpsc::channel::<Vec<u8>>();
        let mut term = Term::new(
            TerminalConfig::default(),
            &TermSize::new(20, 6),
            test_terminal_event_proxy(input_tx),
        );
        let mut processor = TerminalProcessor::<TerminalSyncHandler>::new();

        processor.advance(&mut term, "算了\r\n好的\r\n".as_bytes());

        let frame: serde_json::Value =
            serde_json::from_str(&terminal_frame(&term, None).expect("terminal frame"))
                .expect("frame json");
        let all_text = terminal_frame_text(&frame);

        assert!(all_text.contains("算了"));
        assert!(all_text.contains("好的"));
        assert!(
            !all_text.contains("算 了") && !all_text.contains("好 的"),
            "wide-character spacer cells should not serialize as literal spaces: {all_text:?}"
        );
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
    fn terminal_session_survives_websocket_reconnect() {
        let repo = create_basic_repo();
        let state = TerminalState::default();
        let session = spawn_terminal_session(&state, &repo, None, Some(80), Some(12))
            .expect("spawn terminal session");

        // Write a sentinel marker through the first connection, then drop it to
        // simulate the terminal panel being hidden/unmounted.
        let mut websocket = connect_terminal_websocket(&session);
        websocket
            .send(Message::Text(
                "printf '\nVIEW_TERMINAL_RECONNECT_MARKER\n'\r".to_string(),
            ))
            .expect("send terminal input");
        let frame_text = read_terminal_until_text(&mut websocket, "VIEW_TERMINAL_RECONNECT_MARKER");
        assert!(frame_text.contains("VIEW_TERMINAL_RECONNECT_MARKER"));
        let _ = websocket.close(None);

        // A new connection to the same live PTY should render the marker that
        // the previous connection wrote, proving the session state persisted.
        let mut websocket = connect_terminal_websocket(&session);
        let frame_text = read_terminal_until_text(&mut websocket, "VIEW_TERMINAL_RECONNECT_MARKER");
        assert!(
            frame_text.contains("VIEW_TERMINAL_RECONNECT_MARKER"),
            "reconnected terminal should render prior screen state"
        );

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

    fn paths_equal_ci(left: &str, right: &str) -> bool {
        #[cfg(windows)]
        {
            left.to_ascii_lowercase() == right.to_ascii_lowercase()
        }
        #[cfg(not(windows))]
        {
            left == right
        }
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
    fn load_repository_supports_plain_directory() {
        let workspace = create_plain_workspace();
        fs::create_dir_all(workspace.join("src")).expect("create src");
        fs::write(workspace.join("src").join("main.ts"), "export {};\n").expect("write file");

        let payload = tauri::async_runtime::block_on(load_repository(
            workspace.to_string_lossy().to_string(),
            None,
            None,
        ))
        .expect("load plain directory");

        assert!(!payload.summary.is_git_repo);
        assert_eq!(
            payload.summary.root,
            workspace
                .canonicalize()
                .expect("canonical workspace")
                .to_string_lossy()
                .to_string()
        );
        assert!(payload.commits.is_empty());
        assert!(payload.files.is_empty());

        fs::remove_dir_all(workspace).ok();
    }

    #[test]
    fn project_files_include_plain_directory_files() {
        let workspace = create_plain_workspace();
        fs::create_dir_all(workspace.join("nested")).expect("create nested");
        fs::write(workspace.join("top.txt"), "top\n").expect("write top");
        fs::write(workspace.join("nested").join("child.txt"), "child\n").expect("write child");

        let files = tauri::async_runtime::block_on(get_project_files(
            workspace.to_string_lossy().to_string(),
        ))
        .expect("list plain directory files");

        assert!(
            files
                .iter()
                .any(|file| file.path == "top.txt" && file.status.is_none()),
            "top-level files should appear in non-git folders"
        );
        assert!(
            files
                .iter()
                .any(|file| file.path == "nested/child.txt" && file.status.is_none()),
            "nested files should appear in non-git folders"
        );

        fs::remove_dir_all(workspace).ok();
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
    fn resolve_import_path_maps_js_alias_to_ts_source() {
        let repo = create_plain_workspace();
        write_repo_file(
            &repo,
            "tsconfig.json",
            r#"{"compilerOptions":{"baseUrl":".","paths":{"@/*":["src/*"]}}}"#,
        );
        write_repo_file(&repo, "src/App.tsx", "");
        write_repo_file(
            &repo,
            "src/lib/model-visibility.ts",
            "export const ok = true;\n",
        );

        let resolved =
            resolve_import_path_in_root(&repo, "src/App.tsx", "@/lib/model-visibility.js")
                .expect("resolve import");

        assert_eq!(resolved.as_deref(), Some("src/lib/model-visibility.ts"));
        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn resolve_import_path_resolves_relative_index_file() {
        let repo = create_plain_workspace();
        write_repo_file(&repo, "src/features/app.ts", "");
        write_repo_file(&repo, "src/features/session/index.ts", "export {}\n");

        let resolved = resolve_import_path_in_root(&repo, "src/features/app.ts", "./session")
            .expect("resolve import");

        assert_eq!(resolved.as_deref(), Some("src/features/session/index.ts"));
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
    fn status_v2_fingerprint_inputs_separate_head_summary_and_status() {
        let status = [
            "# branch.oid abc123",
            "# branch.head main",
            "# branch.ab +0 -0",
            "1 .M N... file.txt",
        ]
        .join("\0");
        let (head, summary, file_status) = split_status_v2_fingerprint_inputs(&status);

        assert_eq!(head, "abc123");
        assert!(!summary.contains("branch.oid"));
        assert!(summary.contains("# branch.head main"));
        assert!(summary.contains("# branch.ab +0 -0"));
        assert!(!file_status.contains("branch."));
        assert!(file_status.contains("1 .M N... file.txt"));
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
        let response = tauri::async_runtime::block_on(search_editor_text(
            "a😀 beta\n第二个 Beta\n".to_string(),
            "beta".to_string(),
        ))
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
        let response = tauri::async_runtime::block_on(replace_editor_text(
            "Alpha beta BETA".to_string(),
            "beta".to_string(),
            "gamma".to_string(),
            0,
            true,
        ))
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

        let error = tauri::async_runtime::block_on(pull_current_branch(
            repo.to_string_lossy().to_string(),
            "squash".to_string(),
        ))
        .expect_err("unknown pull mode should be rejected");
        assert_eq!(error, "Pull mode must be merge or rebase");

        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn git_operation_state_reports_merge_conflict() {
        let repo = create_basic_repo();
        fs::write(repo.join("tracked.txt"), "base\n").expect("write base");
        run_git(&repo, &["add", "."]);
        run_git(&repo, &["commit", "-m", "base"]);

        run_git(&repo, &["checkout", "-b", "feature"]);
        fs::write(repo.join("tracked.txt"), "feature\n").expect("write feature");
        run_git(&repo, &["commit", "-am", "feature"]);
        run_git(&repo, &["checkout", "main"]);
        fs::write(repo.join("tracked.txt"), "main\n").expect("write main");
        run_git(&repo, &["commit", "-am", "main"]);

        let output = Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["merge", "feature"])
            .output()
            .expect("run conflicting merge");
        assert!(!output.status.success());

        let state = git_operation_state_for_repo(&repo).expect("operation state");
        assert_eq!(state.kind, Some(GitOperationKind::Merge));
        assert_eq!(state.conflict_count, 1);
        assert!(state.can_continue);
        assert!(state.can_abort);
        assert!(!state.can_skip);

        run_git(&repo, &["merge", "--abort"]);
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

    #[test]
    fn git_log_applies_backend_commit_filters() {
        let repo = create_basic_repo();

        write_repo_file(&repo, "src/alpha.txt", "alpha\n");
        run_git(&repo, &["add", "src/alpha.txt"]);
        run_git_env(
            &repo,
            &["commit", "-m", "initial alpha"],
            &[
                ("GIT_AUTHOR_NAME", "Alice Doe"),
                ("GIT_AUTHOR_EMAIL", "alice@example.test"),
                ("GIT_AUTHOR_DATE", "2024-01-10T09:00:00+00:00"),
                ("GIT_COMMITTER_DATE", "2024-01-10T09:00:00+00:00"),
            ],
        );

        write_repo_file(&repo, "notes.txt", "notes\n");
        run_git(&repo, &["add", "notes.txt"]);
        run_git_env(
            &repo,
            &["commit", "-m", "update notes"],
            &[
                ("GIT_AUTHOR_NAME", "Bob Example"),
                ("GIT_AUTHOR_EMAIL", "bob@example.test"),
                ("GIT_AUTHOR_DATE", "2024-03-15T12:00:00+00:00"),
                ("GIT_COMMITTER_DATE", "2024-03-15T12:00:00+00:00"),
            ],
        );

        write_repo_file(&repo, "src/beta.txt", "beta\n");
        run_git(&repo, &["add", "src/beta.txt"]);
        run_git_env(
            &repo,
            &["commit", "-m", "refactor beta"],
            &[
                ("GIT_AUTHOR_NAME", "Alice Doe"),
                ("GIT_AUTHOR_EMAIL", "alice@example.test"),
                ("GIT_COMMITTER_DATE", "2024-05-20T15:30:00+00:00"),
            ],
        );

        let filtered = git_log(
            &repo,
            Some("main"),
            Some("author:\"Alice Doe\" path:src after:2024-02-01 refactor"),
        )
        .expect("filtered git log");
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].subject, "refactor beta");
        assert_eq!(filtered[0].author, "Alice Doe");

        let path_only =
            git_log(&repo, Some("main"), Some("path:notes.txt")).expect("path filtered git log");
        assert_eq!(path_only.len(), 1);
        assert_eq!(path_only[0].subject, "update notes");

        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn git_reflog_filters_entries_on_backend() {
        let repo = create_basic_repo();

        write_repo_file(&repo, "notes.txt", "notes\n");
        run_git(&repo, &["add", "notes.txt"]);
        run_git(&repo, &["commit", "-m", "update notes"]);

        write_repo_file(&repo, "feature.txt", "feature\n");
        run_git(&repo, &["add", "feature.txt"]);
        run_git(&repo, &["commit", "-m", "feature work"]);

        let filtered = git_reflog(&repo, Some("notes")).expect("filtered reflog");
        assert_eq!(filtered.len(), 1);
        assert!(filtered[0].action.contains("update notes"));
        assert_eq!(
            filtered[0].short_hash,
            run_git(&repo, &["rev-parse", "--short", "HEAD~1"])
        );

        let all_entries = git_reflog(&repo, None).expect("all reflog");
        assert!(all_entries.len() >= 2);

        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn create_sibling_worktree_creates_new_branch_from_start_point() {
        let repo = create_basic_repo();
        write_repo_file(&repo, "README.md", "main\n");
        run_git(&repo, &["add", "README.md"]);
        run_git(&repo, &["commit", "-m", "initial"]);

        let worktree_name = sibling_test_name(&repo, "feature-worktree");
        let response = create_sibling_worktree(
            &repo,
            &worktree_name,
            "refs/heads/main",
            Some("feature/worktree"),
        )
        .expect("create sibling worktree");
        let worktree_path = response.active_path.expect("created path");
        let worktree = PathBuf::from(&worktree_path);

        assert!(worktree.is_dir());
        assert_eq!(
            worktree.parent(),
            repo.parent(),
            "created worktree should be a sibling of the active repository"
        );
        assert_eq!(
            run_git(&worktree, &["branch", "--show-current"]),
            "feature/worktree"
        );
        assert!(response.summary.worktrees.iter().any(|entry| {
            entry.path == worktree_path && entry.branch.as_deref() == Some("feature/worktree")
        }));

        run_git(&repo, &["worktree", "remove", "--force", &worktree_path]);
        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn create_sibling_worktree_rejects_paths_instead_of_folder_names() {
        let repo = create_basic_repo();
        write_repo_file(&repo, "README.md", "main\n");
        run_git(&repo, &["add", "README.md"]);
        run_git(&repo, &["commit", "-m", "initial"]);

        let error = match create_sibling_worktree(&repo, "../escape", "refs/heads/main", None) {
            Ok(_) => panic!("escape path should fail"),
            Err(error) => error,
        };

        assert!(error.contains("single folder name"));
        assert!(!repo.parent().expect("repo parent").join("escape").exists());

        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn remove_known_worktree_deletes_registered_non_active_worktree() {
        let repo = create_basic_repo();
        write_repo_file(&repo, "README.md", "main\n");
        run_git(&repo, &["add", "README.md"]);
        run_git(&repo, &["commit", "-m", "initial"]);

        let worktree = repo
            .parent()
            .expect("repo parent")
            .join(sibling_test_name(&repo, "remove-worktree"));
        let worktree_path = worktree.to_string_lossy().to_string();
        run_git(
            &repo,
            &[
                "worktree",
                "add",
                "-b",
                "remove-worktree",
                &worktree_path,
                "refs/heads/main",
            ],
        );

        let response =
            remove_known_worktree(&repo, &worktree_path, false).expect("remove worktree");

        assert!(!worktree.exists());
        assert!(!response
            .summary
            .worktrees
            .iter()
            .any(|entry| entry.path == worktree_path));
        fs::remove_dir_all(repo).ok();
    }

    #[test]
    fn remove_known_worktree_rejects_unknown_paths() {
        let repo = create_basic_repo();
        write_repo_file(&repo, "README.md", "main\n");
        run_git(&repo, &["add", "README.md"]);
        run_git(&repo, &["commit", "-m", "initial"]);

        let unknown = repo
            .parent()
            .expect("repo parent")
            .join(sibling_test_name(&repo, "unknown-worktree"));
        fs::create_dir_all(&unknown).expect("create unknown path");

        let error = match remove_known_worktree(&repo, &unknown.to_string_lossy(), false) {
            Ok(_) => panic!("unknown path should fail"),
            Err(error) => error,
        };

        assert!(error.contains("known worktree"));
        assert!(unknown.exists());
        fs::remove_dir_all(unknown).ok();
        fs::remove_dir_all(repo).ok();
    }

    fn create_basic_repo() -> PathBuf {
        let repo = unique_temp_repo_path();
        fs::create_dir_all(&repo).expect("create temp repo");

        run_git(&repo, &["init", "--initial-branch=main"]);
        run_git(&repo, &["config", "user.email", "view@example.test"]);
        run_git(&repo, &["config", "user.name", "View Test"]);
        repo
    }

    fn create_plain_workspace() -> PathBuf {
        let workspace = unique_temp_repo_path();
        fs::create_dir_all(&workspace).expect("create plain workspace");
        workspace
    }

    fn unique_temp_repo_path() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        env::temp_dir().join(format!("view-merge-test-{}-{nanos}", std::process::id()))
    }

    fn sibling_test_name(repo: &Path, suffix: &str) -> String {
        format!(
            "{}-{suffix}",
            repo.file_name().expect("repo file name").to_string_lossy()
        )
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

    fn run_git_env(repo: &Path, args: &[&str], envs: &[(&str, &str)]) -> String {
        let mut command = Command::new("git");
        command.arg("-C").arg(repo).args(args);
        for (key, value) in envs {
            command.env(*key, *value);
        }

        let output = command
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

    fn write_repo_file(repo: &Path, file_path: &str, contents: &str) {
        let full_path = repo.join(file_path);
        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent).expect("create parent directories");
        }
        fs::write(full_path, contents).expect("write repo file");
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
        .invoke_handler(tauri::generate_handler![
            default_start_path,
            list_system_fonts,
            list_terminal_shells,
            open_external_url,
            load_repository,
            get_diff,
            get_file_diff,
            get_commits,
            get_reflog,
            get_project_files,
            get_project_state_fingerprint,
            get_changed_files,
            get_file_blob,
            get_file_content,
            resolve_import_path,
            get_file_blame,
            save_file_content,
            create_project_file,
            clipboard_paste::write_pasted_files,
            clipboard_paste::paste_clipboard_into_project,
            clipboard_paste::paste_project_files,
            rename_project_file,
            delete_project_file,
            search_file_names,
            search_file_contents,
            search_symbol_references,
            cancel_symbol_reference_search,
            detect_project_scripts,
            get_file_run_targets,
            search_editor_text,
            replace_editor_text,
            fetch_remotes,
            checkout_branch,
            create_branch,
            create_worktree,
            remove_worktree,
            prune_worktrees,
            rename_branch,
            delete_branch,
            pull_current_branch,
            get_git_operation_state,
            continue_git_operation,
            abort_git_operation,
            skip_git_operation,
            git_commit_push::create_commit,
            git_commit_push::push_current_branch,
            git_commit_push::reset_hard_to_reflog,
            git_history_ops::cherry_pick_commit,
            git_history_ops::revert_commit,
            git_stash::list_stashes,
            git_stash::create_stash,
            git_stash::apply_stash,
            git_stash::pop_stash,
            git_stash::drop_stash,
            git_stash::get_stash_diff,
            git_write::get_file_status_diff,
            git_write::apply_file_change,
            git_write::stage_files,
            git_write::unstage_files,
            git_write::mark_conflicts_resolved,
            git_restore::restore_files,
            terminal_spawn,
            terminal_resize,
            terminal_scroll,
            terminal_kill,
            wsl::wsl_display_scale_for_monitor
        ])
        .run(tauri::generate_context!())
        // SAFE-EXPECT: Tauri can only fail here during unrecoverable app bootstrap.
        .expect("error while running tauri application");
}
