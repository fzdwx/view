import type { RepositoryPayload } from "./api";

export function commitPanelFiles(
  worktreeFiles: RepositoryPayload["files"] | undefined,
): RepositoryPayload["files"] {
  return worktreeFiles ?? [];
}
