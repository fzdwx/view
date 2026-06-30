export type CommitEditActionKind =
  | "amend"
  | "fixup"
  | "rebase"
  | "reword"
  | "squash";

export interface CommitEditAvailabilityInput {
  readonly activeProjectPath: string | null;
  readonly hasGitRepository: boolean;
  readonly pendingReason: string | null;
}

export function commitEditDisabledReason({
  activeProjectPath,
  hasGitRepository,
  pendingReason,
}: CommitEditAvailabilityInput): string | null {
  if (!activeProjectPath) {
    return "Open a folder before editing history.";
  }
  if (!hasGitRepository) {
    return "Open a Git repository before editing history.";
  }
  return pendingReason;
}

export function commitEditConfirmation(
  kind: CommitEditActionKind,
  commitLabel: string,
): string {
  switch (kind) {
    case "amend":
      return "Amend HEAD with staged changes?";
    case "fixup":
      return `Fixup ${commitLabel} with staged changes?`;
    case "rebase":
      return `Start interactive rebase from ${commitLabel}?`;
    case "reword":
      return `Reword ${commitLabel}?`;
    case "squash":
      return `Squash ${commitLabel} into its parent?`;
  }
}
