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

export type GitStatus =
  | "added"
  | "deleted"
  | "ignored"
  | "modified"
  | "renamed"
  | "untracked";

export interface TreeFile {
  path: string;
  status: GitStatus | null;
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
}

export interface TerminalSessionInfo {
  id: string;
  cwd: string;
  pid: number | null;
  wsUrl: string;
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
): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("get_commits", {
    path,
    branch: branch ?? null,
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

export async function searchFiles(
  path: string,
  query: string,
  limit?: number,
): Promise<FileSearchResult[]> {
  return invoke<FileSearchResult[]>("search_files", {
    path,
    query,
    limit: limit ?? null,
  });
}

export async function fetchRemotes(path: string): Promise<void> {
  return invoke<void>("fetch_remotes", { path });
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

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
