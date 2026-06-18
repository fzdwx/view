import { Loader2, Upload } from "lucide-react";
import type { BranchInfo } from "../../lib/api";
import type { GitWriteActions } from "../../hooks/useGitWriteActions";

export interface PushAffordanceProps {
  readonly displayedBranch: BranchInfo | null;
  readonly gitWriteActions: GitWriteActions;
}

export function PushAffordance({
  displayedBranch,
  gitWriteActions,
}: PushAffordanceProps) {
  const availability = pushAvailability(displayedBranch, gitWriteActions);
  const buttonLabel = gitWriteActions.pushPending
    ? "Pushing"
    : availability.aheadCount > 0
      ? `Push ${availability.aheadCount}`
      : "Push";

  function handlePush() {
    if (!availability.canPush) {
      return;
    }
    void gitWriteActions.pushCurrentBranchToUpstream();
  }

  return (
    <span className="commit-push-control">
      <button
        className="commit-push-button"
        type="button"
        disabled={!availability.canPush}
        title={availability.title}
        aria-label={availability.title}
        onClick={handlePush}
      >
        {gitWriteActions.pushPending ? (
          <Loader2 className="spin" size={13} />
        ) : (
          <Upload size={13} />
        )}
        <span>{buttonLabel}</span>
      </button>
      {gitWriteActions.pushError ? (
        <span
          className="commit-push-error"
          role="alert"
          title={gitWriteActions.pushError}
        >
          {gitWriteActions.pushError}
        </span>
      ) : null}
    </span>
  );
}

interface PushAvailability {
  readonly aheadCount: number;
  readonly canPush: boolean;
  readonly title: string;
}

function pushAvailability(
  displayedBranch: BranchInfo | null,
  gitWriteActions: GitWriteActions,
): PushAvailability {
  const currentBranch = gitWriteActions.currentBranch;
  const aheadCount = displayedBranch?.ahead ?? 0;

  if (gitWriteActions.pushPending) {
    return {
      aheadCount,
      canPush: false,
      title: "Pushing current branch to upstream.",
    };
  }
  if (gitWriteActions.gitWritePendingReason) {
    return {
      aheadCount,
      canPush: false,
      title: gitWriteActions.gitWritePendingReason,
    };
  }
  if (!isDisplayedCurrentLocalBranch(displayedBranch, currentBranch)) {
    return {
      aheadCount: 0,
      canPush: false,
      title: displayedBranchBlockedReason(
        displayedBranch,
        currentBranch,
        gitWriteActions.pushDisabledReason,
      ),
    };
  }
  if (gitWriteActions.canPush && displayedBranch?.upstream) {
    return {
      aheadCount,
      canPush: true,
      title: `Push ${aheadCount} commit${aheadCount === 1 ? "" : "s"} from ${displayedBranch.name} to ${displayedBranch.upstream}.`,
    };
  }

  return {
    aheadCount,
    canPush: false,
    title: pushBlockedReason(displayedBranch, gitWriteActions.pushDisabledReason),
  };
}

function isDisplayedCurrentLocalBranch(
  displayedBranch: BranchInfo | null,
  currentBranch: BranchInfo | null,
): boolean {
  return (
    displayedBranch?.branchType === "local" &&
    currentBranch?.branchType === "local" &&
    currentBranch.current &&
    displayedBranch.refName === currentBranch.refName
  );
}

function displayedBranchBlockedReason(
  displayedBranch: BranchInfo | null,
  currentBranch: BranchInfo | null,
  fallbackReason: string | null,
): string {
  if (!currentBranch) {
    return fallbackReason ?? "Checkout a local branch before pushing.";
  }
  if (!displayedBranch) {
    return `Select the current local branch (${currentBranch.name}) before pushing.`;
  }

  return `Push is only available for the current local branch (${currentBranch.name}); ${displayedBranch.name} is selected.`;
}

function pushBlockedReason(
  currentBranch: BranchInfo | null,
  fallbackReason: string | null,
): string {
  if (!currentBranch?.current || currentBranch.branchType !== "local") {
    return fallbackReason ?? "Checkout a local branch before pushing.";
  }
  if (!currentBranch.upstream) {
    return "Configure an upstream before pushing this branch.";
  }
  if (currentBranch.ahead === null || currentBranch.behind === null) {
    return "Fetch branch status before pushing.";
  }
  if (currentBranch.behind > 0 && currentBranch.ahead > 0) {
    return "Current branch has diverged; pull or rebase before pushing.";
  }
  if (currentBranch.behind > 0) {
    return "Current branch is behind its upstream; pull or rebase before pushing.";
  }
  if (currentBranch.ahead <= 0) {
    return "Current branch has no commits to push.";
  }

  return fallbackReason ?? "Push is unavailable.";
}
