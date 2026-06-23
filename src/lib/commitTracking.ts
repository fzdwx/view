import type { CommitInfo } from "./api";

export interface CommitTrackingPresentation {
  readonly className: string;
  readonly label: string;
  readonly title: string;
}

export function commitTrackingPresentation(
  commit: Pick<CommitInfo, "tracking">,
): CommitTrackingPresentation | null {
  if (!commit.tracking) {
    return null;
  }

  return {
    className: `commit-tracking-badge ${commit.tracking.side}`,
    label: commit.tracking.label,
    title: `${commit.tracking.label} contains this commit; ${commit.tracking.compareLabel} does not.`,
  };
}
