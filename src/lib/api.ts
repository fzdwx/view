import { invoke } from "@tauri-apps/api/core";

export interface StatusCounts {
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
  untracked: number;
}

export interface WorktreeInfo {
  path: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
  bare: boolean;
}

export interface BranchInfo {
  name: string;
  refName: string;
  branchType: "local" | "remote";
  current: boolean;
  ahead: number | null;
  behind: number | null;
  upstream: string | null;
}

export interface TagInfo {
  name: string;
  refName: string;
}

export interface RepositorySummary {
  root: string;
  branch: string;
  head: string;
  isGitRepo: boolean;
  statusCounts: StatusCounts;
  worktrees: WorktreeInfo[];
  branches: BranchInfo[];
  tags: TagInfo[];
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  date: string;
  subject: string;
}

export interface ReflogEntry {
  selector: string;
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  action: string;
  subject: string;
}

export type GitStatus =
  | "added"
  | "conflict"
  | "deleted"
  | "ignored"
  | "modified"
  | "renamed"
  | "untracked";

export type GitPorcelainStatus =
  | " "
  | "!"
  | "?"
  | "A"
  | "C"
  | "D"
  | "M"
  | "R"
  | "T"
  | "U";

export interface TreeFile {
  readonly path: string;
  readonly status: GitStatus | null;
  readonly oldPath?: string | null;
  readonly indexStatus?: GitPorcelainStatus | null;
  readonly worktreeStatus?: GitPorcelainStatus | null;
  readonly staged?: boolean;
  readonly unstaged?: boolean;
  readonly untracked?: boolean;
  readonly renamed?: boolean;
  readonly deleted?: boolean;
  readonly conflict?: boolean;
}

export interface RepositoryPayload {
  summary: RepositorySummary;
  commits: CommitInfo[];
  files: TreeFile[];
}

export interface FileContent {
  path: string;
  content: string;
  binary: boolean;
  tooLarge: boolean;
  mediaType: string | null;
  mediaDataUrl: string | null;
}

export interface FileBlameLine {
  lineNumber: number;
  commitHash: string | null;
  shortHash: string | null;
  author: string;
  authorTime: number | null;
  summary: string;
  committed: boolean;
}

export interface SaveConflict {
  path: string;
  baseContent: string;
  currentContent: string;
  proposedContent: string;
}

export interface SaveFileResponse {
  status: "saved" | "conflict";
  file: FileContent | null;
  conflict: SaveConflict | null;
}

export interface FileSearchResult {
  path: string;
  score: number;
  lineNumber: number | null;
  lineText: string | null;
  contextBefore: string[];
  contextAfter: string[];
  matchRanges: [number, number][];
}

export interface EditorTextMatch {
  start: number;
  end: number;
  lineNumber: number;
  lineText: string;
}

export interface EditorSearchResponse {
  matches: EditorTextMatch[];
}

export interface EditorReplaceResponse {
  content: string;
  matches: EditorTextMatch[];
  selectionStart: number;
  selectionEnd: number;
}

export type TerminalCursorStyle = "block" | "bar" | "underline" | "hollowBlock";

export interface TerminalSpawnOptions {
  /** Shell executable to launch, or empty for the platform default. */
  readonly shell: string;
  /** Scrollback history size in lines. */
  readonly scrollbackLines: number;
  /** Cursor shape for the terminal. */
  readonly cursorStyle: TerminalCursorStyle;
  /** Whether to emit visual bell events to the frontend. */
  readonly visualBell: boolean;
}

export interface TerminalSessionInfo {
  id: string;
  cwd: string;
  pid: number | null;
  wsUrl: string;
}

export interface SystemFont {
  family: string;
  monospace: boolean;
}

export interface GitPathsRequest {
  readonly path: string;
  readonly paths: readonly string[];
}

export type RestoreMode = "all" | "staged" | "worktree";

export interface RestoreFilesRequest extends GitPathsRequest {
  readonly mode: RestoreMode;
}

export interface CommitRequest {
  readonly path: string;
  readonly message: string;
}

export interface ResetHardToReflogRequest {
  readonly path: string;
  readonly selector: string;
}

export interface GitWriteResponse {
  readonly summary: RepositorySummary;
  readonly files: TreeFile[];
}

export interface CommitWriteResponse extends GitWriteResponse {
  readonly hash: string;
  readonly shortHash: string;
}

export async function loadRepository(
  path: string,
  commit?: string | null,
  branch?: string | null,
): Promise<RepositoryPayload> {
  return invoke<RepositoryPayload>("load_repository", {
    path,
    commit: commit ?? null,
    branch: branch ?? null,
  });
}

export async function getFileDiff(
  path: string,
  filePath: string,
  commit?: string | null,
): Promise<string> {
  return invoke<string>("get_file_diff", {
    path,
    commit: commit ?? null,
    filePath,
  });
}

export async function getCommits(
  path: string,
  branch?: string | null,
  filter?: string | null,
): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("get_commits", {
    path,
    branch: branch ?? null,
    filter: filter ?? null,
  });
}

export async function getReflog(
  path: string,
  filter?: string | null,
): Promise<ReflogEntry[]> {
  return invoke<ReflogEntry[]>("get_reflog", {
    path,
    filter: filter ?? null,
  });
}

export async function getProjectFiles(path: string): Promise<TreeFile[]> {
  return invoke<TreeFile[]>("get_project_files", { path });
}

export async function getChangedFiles(
  path: string,
  commit?: string | null,
): Promise<TreeFile[]> {
  return invoke<TreeFile[]>("get_changed_files", {
    path,
    commit: commit ?? null,
  });
}

export async function getFileContent(
  path: string,
  filePath: string,
): Promise<FileContent> {
  return invoke<FileContent>("get_file_content", { path, filePath });
}

export async function getFileBlame(
  path: string,
  filePath: string,
): Promise<FileBlameLine[]> {
  return invoke<FileBlameLine[]>("get_file_blame", { path, filePath });
}

export async function getFileBlob(
  path: string,
  filePath: string,
  ref: string | null,
): Promise<FileContent> {
  return invoke<FileContent>("get_file_blob", { path, filePath, refName: ref });
}

export async function saveFileContent(
  path: string,
  filePath: string,
  baseContent: string,
  content: string,
): Promise<SaveFileResponse> {
  return invoke<SaveFileResponse>("save_file_content", {
    request: {
      path,
      filePath,
      baseContent,
      content,
    },
  });
}

export async function createProjectFile(
  path: string,
  filePath: string,
): Promise<string> {
  return invoke<string>("create_project_file", { path, filePath });
}

export interface PastedFile {
  relativePath: string;
  bytes: Uint8Array;
}

export async function writePastedFiles(
  path: string,
  destDir: string | null,
  files: readonly PastedFile[],
): Promise<string[]> {
  // Tauri's invoke serializes arguments as JSON, which turns a Uint8Array into
  // an indexed object rather than a number array. Convert to a plain number[]
  // so the Rust Vec<u8> deserializes correctly.
  const serializableFiles = files.map((file) => ({
    relativePath: file.relativePath,
    bytes: Array.from(file.bytes),
  }));
  return invoke<string[]>("write_pasted_files", {
    path,
    destDir: destDir ?? null,
    files: serializableFiles,
  });
}

export async function pasteClipboardIntoProject(
  path: string,
  destDir: string | null,
): Promise<string[]> {
  return invoke<string[]>("paste_clipboard_into_project", {
    path,
    destDir: destDir ?? null,
  });
}

export async function pasteProjectFiles(
  path: string,
  sourcePath: string,
  sourceFiles: readonly string[],
  destDir: string | null,
): Promise<string[]> {
  return invoke<string[]>("paste_project_files", {
    path,
    sourcePath,
    sourceFiles,
    destDir: destDir ?? null,
  });
}

export async function renameProjectFile(
  path: string,
  fromPath: string,
  toPath: string,
): Promise<string> {
  return invoke<string>("rename_project_file", { path, fromPath, toPath });
}

export async function deleteProjectFile(
  path: string,
  filePath: string,
): Promise<void> {
  return invoke<void>("delete_project_file", { path, filePath });
}

export async function searchFileNames(
  path: string,
  query: string,
  limit?: number,
): Promise<FileSearchResult[]> {
  return invoke<FileSearchResult[]>("search_file_names", {
    path,
    query,
    limit: limit ?? null,
  });
}

export async function searchFileContents(
  path: string,
  query: string,
  limit?: number,
): Promise<FileSearchResult[]> {
  return invoke<FileSearchResult[]>("search_file_contents", {
    path,
    query,
    limit: limit ?? null,
  });
}

export async function searchEditorText(
  content: string,
  query: string,
): Promise<EditorSearchResponse> {
  if (!isTauriRuntime()) {
    return {
      matches: editorTextMatchesInBrowser(content, query),
    };
  }

  return invoke<EditorSearchResponse>("search_editor_text", {
    content,
    query,
  });
}

export async function replaceEditorText(
  content: string,
  query: string,
  replacement: string,
  activeIndex: number,
  replaceAll: boolean,
): Promise<EditorReplaceResponse> {
  if (!isTauriRuntime()) {
    return replaceEditorTextInBrowser(
      content,
      query,
      replacement,
      activeIndex,
      replaceAll,
    );
  }

  return invoke<EditorReplaceResponse>("replace_editor_text", {
    content,
    query,
    replacement,
    activeIndex,
    replaceAll,
  });
}

export async function fetchRemotes(path: string): Promise<void> {
  return invoke<void>("fetch_remotes", { path });
}

export async function checkoutBranch(
  path: string,
  refName: string,
): Promise<void> {
  return invoke<void>("checkout_branch", { path, refName });
}

export async function createBranch(
  path: string,
  name: string,
  startPoint: string,
): Promise<void> {
  return invoke<void>("create_branch", { path, name, startPoint });
}

export async function renameBranch(
  path: string,
  refName: string,
  newName: string,
): Promise<void> {
  return invoke<void>("rename_branch", { path, refName, newName });
}

export async function deleteBranch(
  path: string,
  refName: string,
  force: boolean,
): Promise<void> {
  return invoke<void>("delete_branch", { path, refName, force });
}

export type PullMode = "merge" | "rebase";

export async function pullCurrentBranch(
  path: string,
  mode: PullMode,
): Promise<void> {
  return invoke<void>("pull_current_branch", { path, mode });
}

export async function stageFiles(
  request: GitPathsRequest,
): Promise<GitWriteResponse> {
  return invoke<GitWriteResponse>("stage_files", { request });
}

export async function unstageFiles(
  request: GitPathsRequest,
): Promise<GitWriteResponse> {
  return invoke<GitWriteResponse>("unstage_files", { request });
}

export async function restoreFiles(
  request: RestoreFilesRequest,
): Promise<GitWriteResponse> {
  return invoke<GitWriteResponse>("restore_files", { request });
}

export async function createCommit(
  request: CommitRequest,
): Promise<CommitWriteResponse> {
  return invoke<CommitWriteResponse>("create_commit", { request });
}

export async function pushCurrentBranch(
  path: string,
): Promise<GitWriteResponse> {
  return invoke<GitWriteResponse>("push_current_branch", { path });
}

export async function resetHardToReflog(
  request: ResetHardToReflogRequest,
): Promise<GitWriteResponse> {
  return invoke<GitWriteResponse>("reset_hard_to_reflog", { request });
}

export async function terminalSpawn(
  path: string,
  cwd?: string | null,
  cols?: number,
  rows?: number,
  options?: TerminalSpawnOptions,
): Promise<TerminalSessionInfo> {
  return invoke<TerminalSessionInfo>("terminal_spawn", {
    path,
    cwd: cwd ?? null,
    cols: cols ?? null,
    rows: rows ?? null,
    options: options ?? null,
  });
}

export async function terminalResize(
  id: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke<void>("terminal_resize", { id, cols, rows });
}

export async function terminalScroll(id: string, delta: number): Promise<void> {
  return invoke<void>("terminal_scroll", { id, delta });
}

export async function terminalKill(id: string): Promise<void> {
  return invoke<void>("terminal_kill", { id });
}

export async function listSystemFonts(): Promise<SystemFont[]> {
  return invoke<SystemFont[]>("list_system_fonts");
}

export interface TerminalShell {
  /** Display label, e.g. "zsh" or "PowerShell". */
  readonly label: string;
  /** Absolute path to the shell executable, or empty for the platform default. */
  readonly path: string;
}

export async function listTerminalShells(): Promise<TerminalShell[]> {
  return invoke<TerminalShell[]>("list_terminal_shells");
}

export interface ProjectScript {
  readonly label: string;
  readonly command: string;
  readonly source: string;
}

export async function detectProjectScripts(path: string): Promise<ProjectScript[]> {
  return invoke<ProjectScript[]>("detect_project_scripts", { path });
}

function replaceEditorTextInBrowser(
  content: string,
  query: string,
  replacement: string,
  activeIndex: number,
  replaceAll: boolean,
): EditorReplaceResponse {
  const matches = editorTextMatchesInBrowser(content, query);
  if (matches.length === 0) {
    return {
      content,
      matches: [],
      selectionStart: 0,
      selectionEnd: 0,
    };
  }

  if (replaceAll) {
    let nextContent = "";
    let cursor = 0;

    for (const match of matches) {
      nextContent += content.slice(cursor, match.start);
      nextContent += replacement;
      cursor = match.end;
    }

    nextContent += content.slice(cursor);
    return {
      content: nextContent,
      matches: editorTextMatchesInBrowser(nextContent, query),
      selectionStart: 0,
      selectionEnd: 0,
    };
  }

  const activeMatch = matches[Math.min(activeIndex, matches.length - 1)];
  const nextContent =
    content.slice(0, activeMatch.start) +
    replacement +
    content.slice(activeMatch.end);
  const selectionStart = activeMatch.start;
  const selectionEnd = selectionStart + replacement.length;

  return {
    content: nextContent,
    matches: editorTextMatchesInBrowser(nextContent, query),
    selectionStart,
    selectionEnd,
  };
}

function editorTextMatchesInBrowser(
  content: string,
  query: string,
): EditorTextMatch[] {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [];
  }

  const { lowered, utf16Indices } = lowercaseWithUtf16Indices(content);
  const needle = trimmedQuery.toLowerCase();
  const matches: EditorTextMatch[] = [];
  let searchFrom = 0;

  while (searchFrom <= lowered.length) {
    // String substring search with an offset; a Set/Map cannot replace it.
    // oxlint-disable-next-line react-doctor/js-set-map-lookups
    const lowerStart = lowered.indexOf(needle, searchFrom);
    if (lowerStart < 0) {
      break;
    }

    const lowerEnd = lowerStart + needle.length;
    const start = utf16Indices[lowerStart];
    let end = lowerEnd < utf16Indices.length ? utf16Indices[lowerEnd] : content.length;

    if (end === start) {
      for (const character of content.slice(start)) {
        end = start + character.length;
        break;
      }
    }

    if (end > start) {
      const { lineNumber, lineText } = lineForUtf16Offset(content, start);
      matches.push({
        start,
        end,
        lineNumber,
        lineText,
      });
    }

    searchFrom = lowerStart + Math.max(needle.length, 1);
  }

  return matches;
}

function lowercaseWithUtf16Indices(content: string): {
  lowered: string;
  utf16Indices: number[];
} {
  let lowered = "";
  const utf16Indices: number[] = [];
  let utf16Offset = 0;

  for (const character of content) {
    const loweredCharacter = character.toLowerCase();
    lowered += loweredCharacter;
    for (let index = 0; index < loweredCharacter.length; index += 1) {
      utf16Indices.push(utf16Offset);
    }
    utf16Offset += character.length;
  }

  return { lowered, utf16Indices };
}

function lineForUtf16Offset(
  content: string,
  start: number,
): {
  lineNumber: number;
  lineText: string;
} {
  const prefix = content.slice(0, start);
  const lineNumber = prefix.split("\n").length;
  const lineStart = prefix.lastIndexOf("\n") + 1;
  const nextLineBreak = content.indexOf("\n", start);
  const lineEnd = nextLineBreak >= 0 ? nextLineBreak : content.length;

  return {
    lineNumber,
    lineText: content.slice(lineStart, lineEnd).replace(/\r$/, ""),
  };
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
