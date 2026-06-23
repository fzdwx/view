import { CheckCircle2, Search } from "lucide-react";
import type { BranchInfo } from "../../lib/api";
import { shortBranchDisplayName } from "../../lib/branchModels";
import type { GitWriteActions } from "../../hooks/useGitWriteActions";
import { PushAffordance } from "./PushAffordance";

export type CommitHistoryMode = "commits" | "reflog";

export interface CommitListHeaderProps {
  readonly activeCommit: string | null;
  readonly branch: BranchInfo | null;
  readonly filter: string;
  readonly gitWriteActions: GitWriteActions;
  readonly historyMode: CommitHistoryMode;
  readonly onChangeFilter: (filter: string) => void;
  readonly onChangeHistoryMode: (mode: CommitHistoryMode) => void;
  readonly onSelectWorkingTree: () => void;
}

export function CommitListHeader({
  activeCommit,
  branch,
  filter,
  gitWriteActions,
  historyMode,
  onChangeFilter,
  onChangeHistoryMode,
  onSelectWorkingTree,
}: CommitListHeaderProps) {
  const isReflogMode = historyMode === "reflog";

  return (
    <div className="commit-list-header">
      <span className="commit-list-worktree-cell">
        <button
          type="button"
          className={activeCommit ? "commit-worktree-button" : "commit-worktree-button active"}
          title="Show working tree"
          aria-label="Show working tree"
          onClick={onSelectWorkingTree}
        >
          <CheckCircle2 size={13} />
        </button>
      </span>
      <div className="commit-header-search">
        <span className="history-view-toggle" role="tablist" aria-label="History source">
          <button
            type="button"
            className={isReflogMode ? "history-view-tab" : "history-view-tab active"}
            role="tab"
            aria-selected={!isReflogMode}
            onClick={() => onChangeHistoryMode("commits")}
          >
            Commits
          </button>
          <button
            type="button"
            className={isReflogMode ? "history-view-tab active" : "history-view-tab"}
            role="tab"
            aria-selected={isReflogMode}
            onClick={() => onChangeHistoryMode("reflog")}
          >
            Reflog
          </button>
        </span>
        <label className="commit-header-search-field">
          <Search size={13} />
          <input
            value={filter}
            onChange={(event) => onChangeFilter(event.target.value)}
            placeholder={
              isReflogMode
                ? "Search reflog"
                : "Search commits or use author:/path:/after:/before:"
            }
            title={
              isReflogMode
                ? "Search reflog action, subject, author, selector, or hash."
                : 'Search commit text, or filter with author:, path:, after:, and before:. Quote values with spaces, like author:"Jane Doe".'
            }
          />
        </label>
        {!isReflogMode ? <BranchRelationSummary branch={branch} /> : null}
        {!isReflogMode ? (
          <PushAffordance
            displayedBranch={branch}
            gitWriteActions={gitWriteActions}
          />
        ) : null}
      </div>
      <span>Author</span>
      <span>{isReflogMode ? "Commit Date" : "Date"}</span>
      <span>Hash</span>
    </div>
  );
}

function BranchRelationSummary({ branch }: { readonly branch: BranchInfo | null }) {
  if (!branch) {
    return null;
  }

  const ahead = branch.ahead ?? 0;
  const behind = branch.behind ?? 0;
  const hasDivergence = ahead > 0 || behind > 0;
  const otherLabel = branch.branchType === "remote" ? "Remote" : "Upstream";

  return (
    <span className="commit-branch-relation" title={branch.refName}>
      <span className="commit-branch-name">{shortBranchDisplayName(branch)}</span>
      {hasDivergence ? (
        <>
          {behind > 0 ? <span className="behind">{otherLabel} +{behind}</span> : null}
          {ahead > 0 ? <span className="ahead">Local +{ahead}</span> : null}
        </>
      ) : (
        <span className="sync">In sync</span>
      )}
    </span>
  );
}
