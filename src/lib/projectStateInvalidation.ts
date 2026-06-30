import type { ProjectStateFingerprint } from "./api";

export type ProjectStateRefreshResult = "changed" | "primed" | "unchanged";

export type ProjectQueryKey = readonly unknown[];

export interface ProjectStateRefreshPlan {
  readonly result: ProjectStateRefreshResult;
  readonly headChanged: boolean;
  readonly summaryChanged: boolean;
  readonly statusChanged: boolean;
  readonly invalidateKeys: readonly ProjectQueryKey[];
  readonly resetKeys: readonly ProjectQueryKey[];
  readonly cancelKeys: readonly ProjectQueryKey[];
}

export interface BuildProjectStateRefreshPlanOptions {
  readonly previous: ProjectStateFingerprint | null;
  readonly next: ProjectStateFingerprint;
  readonly projectPath: string;
  readonly activeCommit?: string | null;
}

const previewStateQueryRoots = [
  "file-blame",
  "file-content",
  "file-staged-diff",
  "file-worktree-diff",
  "file-diff",
] as const;

export function buildProjectStateRefreshPlan({
  previous,
  next,
  projectPath,
}: BuildProjectStateRefreshPlanOptions): ProjectStateRefreshPlan {
  if (!previous) {
    return emptyPlan("primed");
  }

  if (previous.fingerprint === next.fingerprint) {
    return emptyPlan("unchanged");
  }

  const headChanged = previous.headFingerprint !== next.headFingerprint;
  const summaryChanged =
    previous.summaryFingerprint !== next.summaryFingerprint;
  const statusChanged = previous.statusFingerprint !== next.statusFingerprint;
  const historyChanged = headChanged || summaryChanged;
  const worktreeChanged = headChanged || statusChanged;
  const invalidateKeys: ProjectQueryKey[] = [];
  const resetKeys: ProjectQueryKey[] = [];
  const cancelKeys: ProjectQueryKey[] = [];

  if (headChanged || summaryChanged || statusChanged) {
    invalidateKeys.push(["repository", projectPath]);
  }

  if (historyChanged) {
    invalidateKeys.push(["commit-details", projectPath]);
    invalidateKeys.push(["commits", projectPath]);
    invalidateKeys.push(["reflog", projectPath]);
  }

  if (worktreeChanged) {
    invalidateKeys.push(["project-files", projectPath]);
    invalidateKeys.push(["changed-files", projectPath, null]);
    invalidateKeys.push(["git-operation-state", projectPath]);
    invalidateKeys.push(["stashes", projectPath]);
    for (const root of previewStateQueryRoots) {
      const key = [root, projectPath] as const;
      cancelKeys.push(key);
      resetKeys.push(key);
    }
  }

  return {
    result: "changed",
    headChanged,
    summaryChanged,
    statusChanged,
    invalidateKeys,
    resetKeys,
    cancelKeys,
  };
}

export function queryKeyNames(keys: readonly ProjectQueryKey[]): string[] {
  return keys.map((key) => String(key[0]));
}

function emptyPlan(result: Exclude<ProjectStateRefreshResult, "changed">) {
  return {
    result,
    headChanged: false,
    summaryChanged: false,
    statusChanged: false,
    invalidateKeys: [],
    resetKeys: [],
    cancelKeys: [],
  };
}
