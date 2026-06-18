import type { CommitInfo } from "./api";

export function filterCommits(
  commits: readonly CommitInfo[],
  filter: string,
): CommitInfo[] {
  const normalized = filter.trim().toLowerCase();
  if (!normalized) {
    return [...commits];
  }

  return commits.filter((commit) =>
    [commit.subject, commit.author, commit.hash, commit.shortHash]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}
