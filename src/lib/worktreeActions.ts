const unsafeFolderChars = /[^A-Za-z0-9._-]+/g;

export type WorktreeSourceBranch =
  | string
  | {
      readonly name: string;
      readonly branchType: "local" | "remote";
    };

export function defaultWorktreeFolderName(branch: WorktreeSourceBranch): string {
  const branchName = worktreeSourceBranchName(branch);
  const folder = branchName
    .replace(unsafeFolderChars, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return `${folder || "worktree"}-worktree`;
}

export function defaultWorktreeBranchName(branch: WorktreeSourceBranch): string {
  const branchName = worktreeSourceBranchName(branch)
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "/");

  return `${branchName || "worktree"}-worktree`;
}

export function worktreePathLabel(path: string): string {
  const normalized = trimTrailingSeparators(path.replace(/\\/g, "/"));
  return normalized.split("/").filter(Boolean).at(-1) ?? normalized;
}

export function isSameWorktreePath(left: string, right: string): boolean {
  return normalizeWorktreePath(left) === normalizeWorktreePath(right);
}

function worktreeSourceBranchName(branch: WorktreeSourceBranch): string {
  if (typeof branch === "string") {
    return branch.trim();
  }

  const parts = branch.name.trim().split("/").filter(Boolean);
  if (branch.branchType === "remote" && parts.length > 1) {
    return parts.slice(1).join("/");
  }
  return branch.name.trim();
}

function normalizeWorktreePath(path: string): string {
  return trimTrailingSeparators(path.replace(/\\/g, "/"));
}

function trimTrailingSeparators(path: string): string {
  return path.replace(/\/+$/g, "");
}
