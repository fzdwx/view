import type { CommitInfo } from "../../lib/api";
import { commitTrackingPresentation } from "../../lib/commitTracking";

export function CommitTrackingBadge({
  commit,
}: {
  readonly commit: CommitInfo;
}) {
  const presentation = commitTrackingPresentation(commit);
  if (!presentation) {
    return null;
  }

  return (
    <span className={presentation.className} title={presentation.title}>
      {presentation.label}
    </span>
  );
}
