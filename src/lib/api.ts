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

export async function fetchRemotes(path: string): Promise<void> {
  return invoke<void>("fetch_remotes", { path });
}

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
