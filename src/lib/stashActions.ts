export function defaultStashMessage(
  branchName: string | null,
  trackedCount: number,
  untrackedCount: number,
): string {
  if (!branchName) {
    return "WIP";
  }

  const parts: string[] = [];
  if (trackedCount > 0) {
    parts.push(`${trackedCount} tracked`);
  }
  if (untrackedCount > 0) {
    parts.push(`${untrackedCount} untracked`);
  }

  return parts.length > 0 ? `${branchName}: ${parts.join(", ")}` : "WIP";
}

export function shortStashHash(hash: string): string {
  return hash.slice(0, 8);
}
