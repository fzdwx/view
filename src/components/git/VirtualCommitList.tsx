import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { measureElement, useVirtualizer } from "@tanstack/react-virtual";
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

const COMMIT_ROW_ESTIMATE = 34;
const REFLOG_ROW_ESTIMATE = 34;

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
  const lastScrolledCommitRef = useRef<string | null>(null);
  const lastScrolledReflogRef = useRef<string | null>(null);
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
  const commitVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: graphRows.length,
    getScrollElement: () => scrollRef.current,
    directDomUpdates: true,
    directDomUpdatesMode: "transform",
    estimateSize: () => COMMIT_ROW_ESTIMATE,
    getItemKey: (index) => graphRows[index]?.commit.hash ?? index,
    measureElement,
    overscan: 18,
    useAnimationFrameWithResizeObserver: true,
  });
  const reflogVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: reflogEntries.length,
    getScrollElement: () => scrollRef.current,
    directDomUpdates: true,
    directDomUpdatesMode: "transform",
    estimateSize: () => REFLOG_ROW_ESTIMATE,
    getItemKey: (index) =>
      `${reflogEntries[index]?.selector ?? index}:${reflogEntries[index]?.hash ?? ""}`,
    measureElement,
    overscan: 14,
    useAnimationFrameWithResizeObserver: true,
  });
  const activeFilter = isReflogMode ? reflogFilter : filter;
  const activeLoading = isReflogMode ? reflogLoading : loading;
  const activeCommitIndex = useMemo(
    () => (activeCommit ? graphRows.findIndex((row) => row.commit.hash === activeCommit) : -1),
    [activeCommit, graphRows],
  );
  const activeReflogIndex = useMemo(
    () =>
      activeReflogSelector
        ? reflogEntries.findIndex((entry) => entry.selector === activeReflogSelector)
        : -1,
    [activeReflogSelector, reflogEntries],
  );

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
  }, [activeFilter, isReflogMode]);

  useEffect(() => {
    if (!activeCommit) {
      lastScrolledCommitRef.current = null;
      return;
    }
    if (
      isReflogMode ||
      activeCommitIndex < 0 ||
      lastScrolledCommitRef.current === activeCommit
    ) {
      return;
    }
    commitVirtualizer.scrollToIndex(activeCommitIndex, {
      align: "auto",
      behavior: "smooth",
    });
    lastScrolledCommitRef.current = activeCommit;
  }, [activeCommit, activeCommitIndex, commitVirtualizer, isReflogMode]);

  useEffect(() => {
    if (!activeReflogSelector) {
      lastScrolledReflogRef.current = null;
      return;
    }
    if (
      !isReflogMode ||
      activeReflogIndex < 0 ||
      lastScrolledReflogRef.current === activeReflogSelector
    ) {
      return;
    }
    reflogVirtualizer.scrollToIndex(activeReflogIndex, {
      align: "auto",
      behavior: "smooth",
    });
    lastScrolledReflogRef.current = activeReflogSelector;
  }, [
    activeReflogIndex,
    activeReflogSelector,
    isReflogMode,
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
          <div ref={reflogVirtualizer.containerRef} className="commit-list-spacer">
            {reflogVirtualizer.getVirtualItems().map((virtualItem) => {
              const entry = reflogEntries[virtualItem.index];
              return (
                <div
                  key={virtualItem.key}
                  className="commit-list-virtual-row"
                  data-index={virtualItem.index}
                  ref={(node) => {
                    reflogVirtualizer.measureElement(node);
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
        <div ref={commitVirtualizer.containerRef} className="commit-list-spacer">
          {commitVirtualizer.getVirtualItems().map((virtualItem) => {
            const graphRow = graphRows[virtualItem.index];
            const commit = graphRow.commit;
            return (
              <div
                key={virtualItem.key}
                className="commit-list-virtual-row"
                data-index={virtualItem.index}
                ref={(node) => {
                  commitVirtualizer.measureElement(node);
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
