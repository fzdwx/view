import type { CSSProperties, KeyboardEvent } from "react";
import { useLayoutEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CheckCircle2, Search } from "lucide-react";
import type { BranchInfo, CommitInfo } from "../../lib/api";
import type { GitWriteActions } from "../../hooks/useGitWriteActions";
import { buildCommitGraph, type CommitGraphRow } from "../../lib/commitGraph";
import { formatDate } from "../../lib/dateFormat";
import { shortBranchDisplayName } from "../../lib/branchModels";
import { LoadingRows } from "../LoadingRows";
import { CommitGraph, getCommitGraphWidth } from "./CommitGraph";
import { PushAffordance } from "./PushAffordance";

export function VirtualCommitList({
  commits,
  graphWidthCommits,
  activeCommit,
  branch,
  filter,
  gitWriteActions,
  loading,
  onChangeFilter,
  onSelectCommit,
  onSelectWorkingTree,
}: {
  commits: CommitInfo[];
  graphWidthCommits: CommitInfo[];
  activeCommit: string | null;
  branch: BranchInfo | null;
  filter: string;
  gitWriteActions: GitWriteActions;
  loading: boolean;
  onChangeFilter(filter: string): void;
  onSelectCommit(hash: string): void;
  onSelectWorkingTree(): void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const graphRows = useMemo(() => buildCommitGraph(commits), [commits]);
  const graphWidthRows = useMemo(
    () => buildCommitGraph(graphWidthCommits),
    [graphWidthCommits],
  );
  const commitGraphWidth = useMemo(
    () =>
      Math.max(
        30,
        ...graphWidthRows.map((row) => getCommitGraphWidth(row.laneCount)),
      ),
    [graphWidthRows],
  );
  const tableStyle = {
    "--commit-graph-width": `${commitGraphWidth}px`,
  } as CSSProperties;
  const virtualizer = useVirtualizer({
    count: graphRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 28,
    getItemKey: (index) => graphRows[index]?.commit.hash ?? index,
    overscan: 16,
  });

  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    virtualizer.scrollToIndex(0, { align: "start" });
  }, [filter, graphRows.length, virtualizer]);

  if (loading) {
    return (
      <div className="commit-table" style={tableStyle}>
        <CommitListHeader
          activeCommit={activeCommit}
          branch={branch}
          filter={filter}
          gitWriteActions={gitWriteActions}
          onChangeFilter={onChangeFilter}
          onSelectWorkingTree={onSelectWorkingTree}
        />
        <div className="commit-list">
          <LoadingRows />
        </div>
      </div>
    );
  }

  if (graphRows.length === 0) {
    return (
      <div className="commit-table" style={tableStyle}>
        <CommitListHeader
          activeCommit={activeCommit}
          branch={branch}
          filter={filter}
          gitWriteActions={gitWriteActions}
          onChangeFilter={onChangeFilter}
          onSelectWorkingTree={onSelectWorkingTree}
        />
        <div className="commit-list empty-list">
          <div className="empty-inline">No commits match the current filter.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="commit-table" style={tableStyle}>
      <CommitListHeader
        activeCommit={activeCommit}
        branch={branch}
        filter={filter}
        gitWriteActions={gitWriteActions}
        onChangeFilter={onChangeFilter}
        onSelectWorkingTree={onSelectWorkingTree}
      />
      <div ref={scrollRef} className="commit-list">
        <div
          className="commit-list-spacer"
          style={{ height: virtualizer.getTotalSize() } as CSSProperties}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const graphRow = graphRows[virtualItem.index];
            const commit = graphRow.commit;
            return (
              <div
                key={commit.hash}
                className="commit-list-virtual-row"
                data-index={virtualItem.index}
                style={{
                  transform: `translate3d(0, ${virtualItem.start}px, 0)`,
                }}
              >
                <CommitRow
                  row={graphRow}
                  active={activeCommit === commit.hash}
                  onClick={() => onSelectCommit(commit.hash)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CommitListHeader({
  activeCommit,
  branch,
  filter,
  gitWriteActions,
  onChangeFilter,
  onSelectWorkingTree,
}: {
  activeCommit: string | null;
  branch: BranchInfo | null;
  filter: string;
  gitWriteActions: GitWriteActions;
  onChangeFilter(filter: string): void;
  onSelectWorkingTree(): void;
}) {
  return (
    <div className="commit-list-header">
      <span className="commit-list-worktree-cell">
        <button
          className={activeCommit ? "commit-worktree-button" : "commit-worktree-button active"}
          title="Show working tree"
          aria-label="Show working tree"
          onClick={onSelectWorkingTree}
        >
          <CheckCircle2 size={13} />
        </button>
      </span>
      <div className="commit-header-search">
        <label className="commit-header-search-field">
          <Search size={13} />
          <input
            value={filter}
            onChange={(event) => onChangeFilter(event.target.value)}
            placeholder="Search commits"
          />
        </label>
        <BranchRelationSummary branch={branch} />
        <PushAffordance
          displayedBranch={branch}
          gitWriteActions={gitWriteActions}
        />
      </div>
      <span>Author</span>
      <span>Date</span>
      <span>Hash</span>
    </div>
  );
}

function BranchRelationSummary({ branch }: { branch: BranchInfo | null }) {
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

function CommitRow({
  row,
  active,
  onClick,
}: {
  row: CommitGraphRow;
  active: boolean;
  onClick(): void;
}) {
  const { commit } = row;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      title={`${commit.subject} (${commit.shortHash})`}
      className={active ? "commit-row active" : "commit-row"}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      <span className="commit-graph-cell">
        <CommitGraph row={row} />
      </span>
      <span className="commit-subject">
        <span>{commit.subject}</span>
      </span>
      <span className="commit-author">{commit.author}</span>
      <span className="commit-date">{formatDate(commit.date)}</span>
      <span className="commit-hash">{commit.shortHash}</span>
    </div>
  );
}
