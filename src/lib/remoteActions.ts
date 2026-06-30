export interface RemoteActionAvailabilityInput {
  readonly activeProjectPath: string | null;
  readonly hasGitRepository: boolean;
  readonly name: string;
  readonly pendingReason: string | null;
  readonly url?: string | null;
}

export function normalizeRemoteName(name: string): string {
  return name.trim();
}

export function normalizeRemoteBranchName(branch: string): string {
  return branch
    .trim()
    .replace(/^refs\/heads\//, "")
    .replace(/^refs\/remotes\/[^/]+\//, "");
}

export function remoteActionDisabledReason({
  activeProjectPath,
  hasGitRepository,
  name,
  pendingReason,
  url,
}: RemoteActionAvailabilityInput): string | null {
  if (!activeProjectPath) {
    return "Open a folder before editing remotes.";
  }
  if (!hasGitRepository) {
    return "Open a Git repository before editing remotes.";
  }
  if (pendingReason) {
    return pendingReason;
  }
  const remoteName = normalizeRemoteName(name);
  if (!remoteName) {
    return "Enter a remote name.";
  }
  if (remoteName.includes("\0")) {
    return "Remote name cannot contain NUL bytes.";
  }
  if (remoteName.startsWith("-") || /\s/.test(remoteName)) {
    return "Remote name cannot start with a dash or contain spaces.";
  }
  if (url != null) {
    const remoteUrl = url.trim();
    if (!remoteUrl) {
      return "Enter a remote URL.";
    }
    if (remoteUrl.includes("\0")) {
      return "Remote URL cannot contain NUL bytes.";
    }
  }
  return null;
}

export function publishBranchLabel(
  branchName: string,
  remoteName: string,
  remoteBranchName: string | null,
): string {
  const branch = normalizeRemoteBranchName(branchName);
  const remote = normalizeRemoteName(remoteName) || "origin";
  const remoteBranch = normalizeRemoteBranchName(remoteBranchName ?? branch);
  return `Publish ${branch} to ${remote}/${remoteBranch}`;
}

export function forceWithLeaseConfirmation(
  branchName: string,
  upstreamLabel: string,
): string {
  return `Force push ${normalizeRemoteBranchName(branchName)} to ${upstreamLabel} with lease?\n\nThis may overwrite commits on the remote if your local tracking ref is current.`;
}
