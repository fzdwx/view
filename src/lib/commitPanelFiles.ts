import type { RepositoryPayload } from "./api";

type RepositoryFiles = Pick<RepositoryPayload, "files">;

export function commitPanelFiles(
  repositoryPayload: RepositoryFiles | undefined,
  _activeCommitFiles?: RepositoryPayload["files"],
): RepositoryPayload["files"] {
  return repositoryPayload?.files ?? [];
}
