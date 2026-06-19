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

export async function getDiff(
  path: string,
  commit?: string | null,
): Promise<string> {
  return invoke<string>("get_diff", {
    path,
    commit: commit ?? null,
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

export async function getFileContent(
  path: string,
  filePath: string,
): Promise<FileContent> {
  return invoke<FileContent>("get_file_content", { path, filePath });
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
): Promise<TerminalSessionInfo> {
  return invoke<TerminalSessionInfo>("terminal_spawn", {
    path,
    cwd: cwd ?? null,
    cols: cols ?? null,
    rows: rows ?? null,
  });
}

export async function terminalResize(
  id: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke<void>("terminal_resize", { id, cols, rows });
}

export async function terminalKill(id: string): Promise<void> {
  return invoke<void>("terminal_kill", { id });
}

export async function listSystemFonts(): Promise<SystemFont[]> {
  return invoke<SystemFont[]>("list_system_fonts");
}

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
