import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CheckCircle2, RotateCcw, Search } from "lucide-react";
import type { BranchInfo, CommitInfo, ReflogEntry } from "../../lib/api";
import type { GitWriteActions } from "../../hooks/useGitWriteActions";
import { buildCommitGraph, type CommitGraphRow } from "../../lib/commitGraph";
import { formatDate } from "../../lib/dateFormat";
import { shortBranchDisplayName } from "../../lib/branchModels";
import { clamp } from "../../lib/numeric";
import { LoadingRows } from "../LoadingRows";
import { CommitGraph, getCommitGraphWidth } from "./CommitGraph";
import { PushAffordance } from "./PushAffordance";

export function VirtualCommitList({
  commits,
  graphWidthCommits,
  activeCommit,
  activeReflogSelector,
  branch,
  filter,
  gitWriteActions,
  historyMode,
  loading,
  onChangeFilter,
  onChangeHistoryMode,
  onChangeReflogFilter,
  reflogEntries,
  reflogFilter,
  reflogLoading,
  onSelectCommit,
  onSelectReflogEntry,
  onRestoreReflogEntry,
  onSelectWorkingTree,
}: {
  commits: CommitInfo[];
  graphWidthCommits: CommitInfo[];
  activeCommit: string | null;
  activeReflogSelector: string | null;
  branch: BranchInfo | null;
  filter: string;
  gitWriteActions: GitWriteActions;
  historyMode: "commits" | "reflog";
  loading: boolean;
  onChangeFilter(filter: string): void;
  onChangeHistoryMode(mode: "commits" | "reflog"): void;
  onChangeReflogFilter(filter: string): void;
  reflogEntries: ReflogEntry[];
  reflogFilter: string;
  reflogLoading: boolean;
  onSelectCommit(hash: string): void;
  onSelectReflogEntry(entry: ReflogEntry): void;
  onRestoreReflogEntry(selector: string): void | Promise<void>;
  onSelectWorkingTree(): void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [reflogMenu, setReflogMenu] = useState<{
    readonly entry: ReflogEntry;
    readonly left: number;
    readonly top: number;
  } | null>(null);
  const isReflogMode = historyMode === "reflog";
  const graphRows = useMemo(
    () => (isReflogMode ? [] : buildCommitGraph(commits)),
    [commits, isReflogMode],
  );
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
  const commitVirtualizer = useVirtualizer({
    count: graphRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 28,
    getItemKey: (index) => graphRows[index]?.commit.hash ?? index,
    overscan: 16,
  });
  const reflogVirtualizer = useVirtualizer({
    count: reflogEntries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 28,
    getItemKey: (index) =>
      `${reflogEntries[index]?.selector ?? index}:${reflogEntries[index]?.hash ?? ""}`,
    overscan: 12,
  });
  const activeFilter = isReflogMode ? reflogFilter : filter;
  const activeLoading = isReflogMode ? reflogLoading : loading;

  useEffect(() => {
    if (!reflogMenu) {
      return;
    }

    const closeMenu = () => setReflogMenu(null);
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [reflogMenu]);

  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    if (isReflogMode) {
      if (reflogEntries.length > 0) {
        reflogVirtualizer.scrollToIndex(0, { align: "start" });
      }
      return;
    }
    if (graphRows.length > 0) {
      commitVirtualizer.scrollToIndex(0, { align: "start" });
    }
  }, [
    activeFilter,
    commitVirtualizer,
    graphRows.length,
    isReflogMode,
    reflogEntries.length,
    reflogVirtualizer,
  ]);

  if (activeLoading) {
    return (
      <div className={isReflogMode ? "reflog-table" : "commit-table"} style={tableStyle}>
        <CommitListHeader
          activeCommit={activeCommit}
          branch={branch}
          filter={activeFilter}
          gitWriteActions={gitWriteActions}
          historyMode={historyMode}
          onChangeFilter={isReflogMode ? onChangeReflogFilter : onChangeFilter}
          onChangeHistoryMode={onChangeHistoryMode}
          onSelectWorkingTree={onSelectWorkingTree}
        />
        <div className="commit-list">
          <LoadingRows />
        </div>
      </div>
    );
  }

  if (!isReflogMode && graphRows.length === 0) {
    return (
      <div className="commit-table" style={tableStyle}>
        <CommitListHeader
          activeCommit={activeCommit}
          branch={branch}
          filter={filter}
          gitWriteActions={gitWriteActions}
          historyMode={historyMode}
          onChangeFilter={onChangeFilter}
          onChangeHistoryMode={onChangeHistoryMode}
          onSelectWorkingTree={onSelectWorkingTree}
        />
        <div className="commit-list empty-list">
          <div className="empty-inline">No commits match the current filter.</div>
        </div>
      </div>
    );
  }

  if (isReflogMode && reflogEntries.length === 0) {
    return (
      <div className="reflog-table" style={tableStyle}>
        <CommitListHeader
          activeCommit={activeCommit}
          branch={branch}
          filter={reflogFilter}
          gitWriteActions={gitWriteActions}
          historyMode={historyMode}
          onChangeFilter={onChangeReflogFilter}
          onChangeHistoryMode={onChangeHistoryMode}
          onSelectWorkingTree={onSelectWorkingTree}
        />
        <div className="commit-list empty-list">
          <div className="empty-inline">No reflog entries match the current filter.</div>
        </div>
      </div>
    );
  }

  if (isReflogMode) {
    return (
      <div className="reflog-table" style={tableStyle}>
        <CommitListHeader
          activeCommit={activeCommit}
          branch={branch}
          filter={reflogFilter}
          gitWriteActions={gitWriteActions}
          historyMode={historyMode}
          onChangeFilter={onChangeReflogFilter}
          onChangeHistoryMode={onChangeHistoryMode}
          onSelectWorkingTree={onSelectWorkingTree}
        />
        <div ref={scrollRef} className="commit-list">
          <div
            className="commit-list-spacer"
            style={{ height: reflogVirtualizer.getTotalSize() } as CSSProperties}
          >
            {reflogVirtualizer.getVirtualItems().map((virtualItem) => {
              const entry = reflogEntries[virtualItem.index];
              return (
                <div
                  key={`${entry.selector}:${entry.hash}`}
                  className="commit-list-virtual-row"
                  data-index={virtualItem.index}
                  style={{
                    transform: `translate3d(0, ${virtualItem.start}px, 0)`,
                  }}
                >
                  <ReflogRow
                    active={activeReflogSelector === entry.selector}
                    entry={entry}
                    onClick={() => onSelectReflogEntry(entry)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onSelectReflogEntry(entry);
                      setReflogMenu({
                        entry,
                        left: event.clientX,
                        top: event.clientY,
                      });
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
        {reflogMenu ? (
          <ReflogContextMenu
            disabled={Boolean(gitWriteActions.resetDisabledReason)}
            disabledReason={gitWriteActions.resetDisabledReason ?? undefined}
            left={reflogMenu.left}
            selector={reflogMenu.entry.selector}
            top={reflogMenu.top}
            onReset={() => {
              setReflogMenu(null);
              void onRestoreReflogEntry(reflogMenu.entry.selector);
            }}
          />
        ) : null}
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
        historyMode={historyMode}
        onChangeFilter={onChangeFilter}
        onChangeHistoryMode={onChangeHistoryMode}
        onSelectWorkingTree={onSelectWorkingTree}
      />
      <div ref={scrollRef} className="commit-list">
        <div
          className="commit-list-spacer"
          style={{ height: commitVirtualizer.getTotalSize() } as CSSProperties}
        >
          {commitVirtualizer.getVirtualItems().map((virtualItem) => {
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
  historyMode,
  onChangeFilter,
  onChangeHistoryMode,
  onSelectWorkingTree,
}: {
  activeCommit: string | null;
  branch: BranchInfo | null;
  filter: string;
  gitWriteActions: GitWriteActions;
  historyMode: "commits" | "reflog";
  onChangeFilter(filter: string): void;
  onChangeHistoryMode(mode: "commits" | "reflog"): void;
  onSelectWorkingTree(): void;
}) {
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

function ReflogRow({
  active,
  entry,
  onClick,
  onContextMenu,
}: {
  active: boolean;
  entry: ReflogEntry;
  onClick(): void;
  onContextMenu(event: ReactMouseEvent<HTMLButtonElement>): void;
}) {
  const subject = reflogPrimaryText(entry);

  return (
    <button
      type="button"
      title={`${subject} (${entry.shortHash})`}
      className={active ? "reflog-row active" : "reflog-row"}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <span className="reflog-selector">{entry.selector}</span>
      <span className="commit-subject reflog-subject">
        <span>{subject}</span>
      </span>
      <span className="commit-author">{entry.author}</span>
      <span className="commit-date">{formatDate(entry.date)}</span>
      <span className="commit-hash">{entry.shortHash}</span>
    </button>
  );
}

function ReflogContextMenu({
  disabled,
  disabledReason,
  left,
  selector,
  top,
  onReset,
}: {
  disabled: boolean;
  disabledReason?: string;
  left: number;
  selector: string;
  top: number;
  onReset(): void;
}) {
  const menuStyle: CSSProperties = {
    left: clamp(left, 8, window.innerWidth - 228),
    top: clamp(top, 8, window.innerHeight - 120),
  };

  return (
    <div
      className="branch-context-menu"
      role="menu"
      tabIndex={-1}
      style={menuStyle}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        className="danger"
        disabled={disabled}
        title={disabledReason ?? `Reset --hard to ${selector}`}
        onClick={onReset}
      >
        <RotateCcw size={13} />
        <span>{`Reset --hard to ${selector}`}</span>
      </button>
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

  return (
    <button
      type="button"
      title={`${commit.subject} (${commit.shortHash})`}
      className={active ? "commit-row active" : "commit-row"}
      onClick={onClick}
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
    </button>
  );
}

function reflogPrimaryText(entry: ReflogEntry): string {
  const subject = entry.subject.trim();
  if (!subject) {
    return entry.action;
  }

  if (entry.action.toLowerCase().includes(subject.toLowerCase())) {
    return entry.action;
  }

  return `${entry.action} - ${subject}`;
}
