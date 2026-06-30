import { invoke } from "@tauri-apps/api/core";
import { timeAsync, type PerfLogFields } from "./performanceLog";

type InvokeArgs = Record<string, unknown> | undefined;

function apiInvoke<T>(command: string, args?: InvokeArgs): Promise<T> {
  return timeAsync(
    `api:${command}`,
    () => invoke<T>(command, args),
    summarizeInvokeArgs(args),
    { slowThresholdMs: apiSlowThreshold(command) },
  );
}

function apiSlowThreshold(command: string): number {
  switch (command) {
    case "get_file_run_targets":
      return 40;
    case "search_symbol_references":
      return 120;
    case "cancel_symbol_reference_search":
      return 40;
    case "get_project_state_fingerprint":
      return 100;
    default:
      return 16;
  }
}

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

export interface WorktreeOperationResponse {
  readonly summary: RepositorySummary;
  readonly activePath: string | null;
}

export type GitOperationKind = "cherryPick" | "merge" | "rebase" | "revert";

export interface GitOperationState {
  readonly kind: GitOperationKind | null;
  readonly conflictCount: number;
  readonly canContinue: boolean;
  readonly canAbort: boolean;
  readonly canSkip: boolean;
}

export interface StashEntry {
  readonly selector: string;
  readonly hash: string;
  readonly branch: string;
  readonly message: string;
}

export interface StashListResponse {
  readonly entries: StashEntry[];
}

export type CommitTrackingSide = "local" | "upstream";

export interface CommitTrackingInfo {
  readonly side: CommitTrackingSide;
  readonly label: string;
  readonly compareLabel: string;
}

export interface CommitInfo {
  readonly hash: string;
  readonly shortHash: string;
  readonly parents: string[];
  readonly author: string;
  readonly date: string;
  readonly subject: string;
  readonly tracking: CommitTrackingInfo | null;
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

export interface ProjectStateFingerprint {
  fingerprint: string;
  headFingerprint: string;
  summaryFingerprint: string;
  statusFingerprint: string;
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
  /** Environment variables applied to this terminal process. */
  readonly env?: Readonly<Record<string, string>>;
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
export type GitChangeSource = "staged" | "worktree";
export type GitChangeOperation = "discard" | "stage" | "unstage";

export interface RestoreFilesRequest extends GitPathsRequest {
  readonly mode: RestoreMode;
}

export interface GitFileChangeRequest {
  readonly path: string;
  readonly filePath: string;
  readonly source: GitChangeSource;
  readonly operation: GitChangeOperation;
  readonly oldStart: number;
  readonly oldLineCount: number;
  readonly newStart: number;
  readonly newLineCount: number;
}

export interface CommitRequest {
  readonly path: string;
  readonly message: string;
}

export interface ResetHardToReflogRequest {
  readonly path: string;
  readonly selector: string;
}

export interface CommitHashRequest {
  readonly path: string;
  readonly commit: string;
}

export interface StashRequest {
  readonly path: string;
  readonly selector: string;
}

export interface CreateStashRequest {
  readonly path: string;
  readonly message: string;
  readonly includeUntracked: boolean;
}

export interface CreateTagRequest {
  readonly path: string;
  readonly name: string;
  readonly target: string;
  readonly message: string;
}

export interface DeleteTagRequest {
  readonly path: string;
  readonly name: string;
}

export interface PushTagRequest {
  readonly path: string;
  readonly name: string;
  readonly remote: string;
}

export interface RemoteInfo {
  readonly name: string;
  readonly url: string;
  readonly pushUrl: string;
}

export interface ListRemotesResponse {
  readonly remotes: RemoteInfo[];
}

export interface AddRemoteRequest {
  readonly path: string;
  readonly name: string;
  readonly url: string;
}

export interface RenameRemoteRequest {
  readonly path: string;
  readonly name: string;
  readonly newName: string;
}

export interface RemoteWriteRequest {
  readonly path: string;
  readonly name: string;
}

export interface SetBranchUpstreamRequest {
  readonly path: string;
  readonly branch: string;
  readonly upstream: string;
}

export interface DeleteRemoteBranchRequest {
  readonly path: string;
  readonly remote: string;
  readonly branch: string;
}

export interface PushCurrentBranchOptions {
  readonly remote?: string | null;
  readonly branch?: string | null;
  readonly setUpstream?: boolean;
  readonly forceWithLease?: boolean;
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
  return apiInvoke<RepositoryPayload>("load_repository", {
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
  return apiInvoke<string>("get_file_diff", {
    path,
    commit: commit ?? null,
    filePath,
  });
}

export async function getFileStatusDiff(
  path: string,
  filePath: string,
  source: GitChangeSource,
): Promise<string> {
  return apiInvoke<string>("get_file_status_diff", {
    path,
    filePath,
    source,
  });
}

export async function getCommits(
  path: string,
  branch?: string | null,
  filter?: string | null,
): Promise<CommitInfo[]> {
  return apiInvoke<CommitInfo[]>("get_commits", {
    path,
    branch: branch ?? null,
    filter: filter ?? null,
  });
}

export async function getReflog(
  path: string,
  filter?: string | null,
): Promise<ReflogEntry[]> {
  return apiInvoke<ReflogEntry[]>("get_reflog", {
    path,
    filter: filter ?? null,
  });
}

export async function getProjectFiles(path: string): Promise<TreeFile[]> {
  return apiInvoke<TreeFile[]>("get_project_files", { path });
}

export async function getProjectStateFingerprint(
  path: string,
): Promise<ProjectStateFingerprint> {
  return apiInvoke<ProjectStateFingerprint>("get_project_state_fingerprint", {
    path,
  });
}

export async function getChangedFiles(
  path: string,
  commit?: string | null,
): Promise<TreeFile[]> {
  return apiInvoke<TreeFile[]>("get_changed_files", {
    path,
    commit: commit ?? null,
  });
}

export async function getFileContent(
  path: string,
  filePath: string,
): Promise<FileContent> {
  return apiInvoke<FileContent>("get_file_content", { path, filePath });
}

export async function resolveImportPath(
  path: string,
  currentFilePath: string,
  importPath: string,
): Promise<string | null> {
  return apiInvoke<string | null>("resolve_import_path", {
    path,
    currentFilePath,
    importPath,
  });
}

export async function getFileBlame(
  path: string,
  filePath: string,
): Promise<FileBlameLine[]> {
  return apiInvoke<FileBlameLine[]>("get_file_blame", { path, filePath });
}

export async function getFileBlob(
  path: string,
  filePath: string,
  ref: string | null,
): Promise<FileContent> {
  return apiInvoke<FileContent>("get_file_blob", { path, filePath, refName: ref });
}

export async function saveFileContent(
  path: string,
  filePath: string,
  baseContent: string,
  content: string,
): Promise<SaveFileResponse> {
  return apiInvoke<SaveFileResponse>("save_file_content", {
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
  return apiInvoke<string>("create_project_file", { path, filePath });
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
  return apiInvoke<string[]>("write_pasted_files", {
    path,
    destDir: destDir ?? null,
    files: serializableFiles,
  });
}

export async function pasteClipboardIntoProject(
  path: string,
  destDir: string | null,
): Promise<string[]> {
  return apiInvoke<string[]>("paste_clipboard_into_project", {
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
  return apiInvoke<string[]>("paste_project_files", {
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
  return apiInvoke<string>("rename_project_file", { path, fromPath, toPath });
}

export async function deleteProjectFile(
  path: string,
  filePath: string,
): Promise<void> {
  return apiInvoke<void>("delete_project_file", { path, filePath });
}

export async function searchFileNames(
  path: string,
  query: string,
  limit?: number,
): Promise<FileSearchResult[]> {
  return apiInvoke<FileSearchResult[]>("search_file_names", {
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
  return apiInvoke<FileSearchResult[]>("search_file_contents", {
    path,
    query,
    limit: limit ?? null,
  });
}

export async function searchSymbolReferences(
  path: string,
  query: string,
  limit?: number,
  currentFilePath?: string | null,
): Promise<FileSearchResult[]> {
  return apiInvoke<FileSearchResult[]>("search_symbol_references", {
    path,
    query,
    limit: limit ?? null,
    currentFilePath: currentFilePath ?? null,
  });
}

export async function cancelSymbolReferenceSearch(path: string): Promise<void> {
  return apiInvoke<void>("cancel_symbol_reference_search", { path });
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

  return apiInvoke<EditorSearchResponse>("search_editor_text", {
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

  return apiInvoke<EditorReplaceResponse>("replace_editor_text", {
    content,
    query,
    replacement,
    activeIndex,
    replaceAll,
  });
}

export async function fetchRemotes(path: string): Promise<void> {
  return apiInvoke<void>("fetch_remotes", { path });
}

export async function checkoutBranch(
  path: string,
  refName: string,
): Promise<void> {
  return apiInvoke<void>("checkout_branch", { path, refName });
}

export async function createBranch(
  path: string,
  name: string,
  startPoint: string,
): Promise<void> {
  return apiInvoke<void>("create_branch", { path, name, startPoint });
}

export async function renameBranch(
  path: string,
  refName: string,
  newName: string,
): Promise<void> {
  return apiInvoke<void>("rename_branch", { path, refName, newName });
}

export async function deleteBranch(
  path: string,
  refName: string,
  force: boolean,
): Promise<void> {
  return apiInvoke<void>("delete_branch", { path, refName, force });
}

export async function createWorktree(
  path: string,
  name: string,
  startPoint: string,
  branchName?: string | null,
): Promise<WorktreeOperationResponse> {
  return apiInvoke<WorktreeOperationResponse>("create_worktree", {
    path,
    name,
    startPoint,
    branchName: branchName ?? null,
  });
}

export async function removeWorktree(
  path: string,
  worktreePath: string,
  force: boolean,
): Promise<WorktreeOperationResponse> {
  return apiInvoke<WorktreeOperationResponse>("remove_worktree", {
    path,
    worktreePath,
    force,
  });
}

export async function pruneWorktrees(
  path: string,
): Promise<WorktreeOperationResponse> {
  return apiInvoke<WorktreeOperationResponse>("prune_worktrees", { path });
}

export type PullMode = "merge" | "rebase";

export async function pullCurrentBranch(
  path: string,
  mode: PullMode,
): Promise<void> {
  return apiInvoke<void>("pull_current_branch", { path, mode });
}

export async function getGitOperationState(
  path: string,
): Promise<GitOperationState> {
  return apiInvoke<GitOperationState>("get_git_operation_state", { path });
}

export async function continueGitOperation(
  path: string,
): Promise<GitWriteResponse> {
  return apiInvoke<GitWriteResponse>("continue_git_operation", { path });
}

export async function abortGitOperation(
  path: string,
): Promise<GitWriteResponse> {
  return apiInvoke<GitWriteResponse>("abort_git_operation", { path });
}

export async function skipGitOperation(
  path: string,
): Promise<GitWriteResponse> {
  return apiInvoke<GitWriteResponse>("skip_git_operation", { path });
}

export async function stageFiles(
  request: GitPathsRequest,
): Promise<GitWriteResponse> {
  return apiInvoke<GitWriteResponse>("stage_files", { request });
}

export async function unstageFiles(
  request: GitPathsRequest,
): Promise<GitWriteResponse> {
  return apiInvoke<GitWriteResponse>("unstage_files", { request });
}

export async function markConflictsResolved(
  request: GitPathsRequest,
): Promise<GitWriteResponse> {
  return apiInvoke<GitWriteResponse>("mark_conflicts_resolved", { request });
}

export async function restoreFiles(
  request: RestoreFilesRequest,
): Promise<GitWriteResponse> {
  return apiInvoke<GitWriteResponse>("restore_files", { request });
}

export async function applyFileChange(
  request: GitFileChangeRequest,
): Promise<GitWriteResponse> {
  return apiInvoke<GitWriteResponse>("apply_file_change", { request });
}

export async function createCommit(
  request: CommitRequest,
): Promise<CommitWriteResponse> {
  return apiInvoke<CommitWriteResponse>("create_commit", { request });
}

export async function pushCurrentBranch(
  path: string,
  options: PushCurrentBranchOptions = {},
): Promise<GitWriteResponse> {
  return apiInvoke<GitWriteResponse>("push_current_branch", {
    request: {
      path,
      remote: options.remote ?? null,
      branch: options.branch ?? null,
      setUpstream: options.setUpstream === true,
      forceWithLease: options.forceWithLease === true,
    },
  });
}

export async function resetHardToReflog(
  request: ResetHardToReflogRequest,
): Promise<GitWriteResponse> {
  return apiInvoke<GitWriteResponse>("reset_hard_to_reflog", { request });
}

export async function cherryPickCommit(
  request: CommitHashRequest,
): Promise<GitWriteResponse> {
  return apiInvoke<GitWriteResponse>("cherry_pick_commit", { request });
}

export async function revertCommit(
  request: CommitHashRequest,
): Promise<GitWriteResponse> {
  return apiInvoke<GitWriteResponse>("revert_commit", { request });
}

export async function createTag(
  request: CreateTagRequest,
): Promise<GitWriteResponse> {
  return apiInvoke<GitWriteResponse>("create_tag", { request });
}

export async function deleteTag(
  request: DeleteTagRequest,
): Promise<GitWriteResponse> {
  return apiInvoke<GitWriteResponse>("delete_tag", { request });
}

export async function pushTag(
  request: PushTagRequest,
): Promise<GitWriteResponse> {
  return apiInvoke<GitWriteResponse>("push_tag", { request });
}

export async function listRemotes(path: string): Promise<ListRemotesResponse> {
  return apiInvoke<ListRemotesResponse>("list_remotes", { path });
}

export async function addRemote(
  request: AddRemoteRequest,
): Promise<GitWriteResponse> {
  return apiInvoke<GitWriteResponse>("add_remote", { request });
}

export async function renameRemote(
  request: RenameRemoteRequest,
): Promise<GitWriteResponse> {
  return apiInvoke<GitWriteResponse>("rename_remote", { request });
}

export async function removeRemote(
  request: RemoteWriteRequest,
): Promise<GitWriteResponse> {
  return apiInvoke<GitWriteResponse>("remove_remote", { request });
}

export async function setBranchUpstream(
  request: SetBranchUpstreamRequest,
): Promise<GitWriteResponse> {
  return apiInvoke<GitWriteResponse>("set_branch_upstream", { request });
}

export async function deleteRemoteBranch(
  request: DeleteRemoteBranchRequest,
): Promise<GitWriteResponse> {
  return apiInvoke<GitWriteResponse>("delete_remote_branch", { request });
}

export async function listStashes(path: string): Promise<StashListResponse> {
  return apiInvoke<StashListResponse>("list_stashes", { path });
}

export async function createStash(
  request: CreateStashRequest,
): Promise<GitWriteResponse> {
  return apiInvoke<GitWriteResponse>("create_stash", { request });
}

export async function applyStash(
  request: StashRequest,
): Promise<GitWriteResponse> {
  return apiInvoke<GitWriteResponse>("apply_stash", { request });
}

export async function popStash(
  request: StashRequest,
): Promise<GitWriteResponse> {
  return apiInvoke<GitWriteResponse>("pop_stash", { request });
}

export async function dropStash(
  request: StashRequest,
): Promise<GitWriteResponse> {
  return apiInvoke<GitWriteResponse>("drop_stash", { request });
}

export async function getStashDiff(
  path: string,
  selector: string,
): Promise<string> {
  return apiInvoke<string>("get_stash_diff", { path, selector });
}

export async function terminalSpawn(
  path: string,
  cwd?: string | null,
  cols?: number,
  rows?: number,
  options?: TerminalSpawnOptions,
): Promise<TerminalSessionInfo> {
  return apiInvoke<TerminalSessionInfo>("terminal_spawn", {
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
  return apiInvoke<void>("terminal_resize", { id, cols, rows });
}

export async function terminalScroll(id: string, delta: number): Promise<void> {
  return apiInvoke<void>("terminal_scroll", { id, delta });
}

export async function terminalKill(id: string): Promise<void> {
  return apiInvoke<void>("terminal_kill", { id });
}

export async function listSystemFonts(): Promise<SystemFont[]> {
  return apiInvoke<SystemFont[]>("list_system_fonts");
}

export interface TerminalShell {
  /** Display label, e.g. "zsh" or "PowerShell". */
  readonly label: string;
  /** Absolute path to the shell executable, or empty for the platform default. */
  readonly path: string;
}

export async function listTerminalShells(): Promise<TerminalShell[]> {
  return apiInvoke<TerminalShell[]>("list_terminal_shells");
}

export async function openExternalUrl(url: string): Promise<void> {
  return apiInvoke<void>("open_external_url", { url });
}

export interface ProjectScript {
  readonly label: string;
  readonly command: string;
  readonly source: string;
}

export async function detectProjectScripts(path: string): Promise<ProjectScript[]> {
  return apiInvoke<ProjectScript[]>("detect_project_scripts", { path });
}

export interface FileRunTarget {
  readonly id: string;
  readonly language: string;
  readonly kind: string;
  readonly name: string;
  readonly label: string;
  readonly line: number;
  readonly command: string;
  readonly cwd: string | null;
}

export async function getFileRunTargets(
  path: string,
  filePath: string,
  content: string,
): Promise<FileRunTarget[]> {
  return apiInvoke<FileRunTarget[]>("get_file_run_targets", {
    path,
    filePath,
    content,
  });
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

function summarizeInvokeArgs(args: InvokeArgs): PerfLogFields {
  if (!args) {
    return {};
  }

  const fields: PerfLogFields = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === "content" || key === "baseContent") {
      fields[`${key}Bytes`] = stringByteLength(value);
      continue;
    }
    if (key === "files" && Array.isArray(value)) {
      fields.files = value.length;
      continue;
    }
    if (key === "path" || key === "filePath" || key === "refName") {
      fields[key] = summarizePathLike(value);
      continue;
    }
    if (key === "request" && isRecord(value)) {
      Object.assign(fields, summarizeInvokeRequest(value));
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      fields[key] = value;
    }
  }

  return fields;
}

function summarizeInvokeRequest(request: Record<string, unknown>): PerfLogFields {
  const fields: PerfLogFields = {};
  if ("path" in request) {
    fields.path = summarizePathLike(request.path);
  }
  if ("filePath" in request) {
    fields.filePath = summarizePathLike(request.filePath);
  }
  if ("paths" in request && Array.isArray(request.paths)) {
    fields.paths = request.paths.length;
  }
  if ("mode" in request && typeof request.mode === "string") {
    fields.mode = request.mode;
  }
  if ("source" in request && typeof request.source === "string") {
    fields.source = request.source;
  }
  if ("operation" in request && typeof request.operation === "string") {
    fields.operation = request.operation;
  }
  if ("message" in request) {
    fields.messageBytes = stringByteLength(request.message);
  }
  if ("content" in request) {
    fields.contentBytes = stringByteLength(request.content);
  }
  if ("baseContent" in request) {
    fields.baseContentBytes = stringByteLength(request.baseContent);
  }
  return fields;
}

function summarizePathLike(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.slice(-3).join("/") || value;
}

function stringByteLength(value: unknown): number | null {
  return typeof value === "string" ? new TextEncoder().encode(value).length : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
