export interface TagActionInput {
  readonly message: string;
  readonly name: string;
}

export interface TagActionAvailabilityInput {
  readonly activeProjectPath: string | null;
  readonly hasGitRepository: boolean;
  readonly name: string;
  readonly pendingReason: string | null;
}

export function normalizeTagActionInput(
  input: TagActionInput,
): TagActionInput {
  return {
    message: input.message.trim(),
    name: normalizeTagName(input.name),
  };
}

export function normalizeTagName(name: string): string {
  const trimmed = name.trim();
  return trimmed.startsWith("refs/tags/")
    ? trimmed.slice("refs/tags/".length).trim()
    : trimmed;
}

export function tagActionDisabledReason({
  activeProjectPath,
  hasGitRepository,
  name,
  pendingReason,
}: TagActionAvailabilityInput): string | null {
  if (!activeProjectPath) {
    return "Open a folder before editing tags.";
  }
  if (!hasGitRepository) {
    return "Open a Git repository before editing tags.";
  }
  if (pendingReason) {
    return pendingReason;
  }
  const normalizedName = normalizeTagName(name);
  if (!normalizedName) {
    return "Enter a tag name.";
  }
  if (normalizedName.includes("\0")) {
    return "Tag name cannot contain NUL bytes.";
  }
  if (normalizedName.startsWith("-")) {
    return "Tag name cannot start with a dash.";
  }
  return null;
}

export function createTagTargetLabel(target: string | null): string {
  const normalizedTarget = target?.trim();
  if (!normalizedTarget) {
    return "HEAD";
  }
  const refName = normalizedTarget
    .replace(/^refs\/heads\//, "")
    .replace(/^refs\/tags\//, "")
    .replace(/^refs\/remotes\//, "");
  if (/^[0-9a-f]{8,}$/i.test(refName)) {
    return refName.slice(0, 7);
  }
  return refName;
}

export function tagPushConfirmation(tagName: string, remote: string): string {
  return `Push tag ${normalizeTagName(tagName)} to ${remote.trim() || "origin"}?`;
}
