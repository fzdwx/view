import type { CSSProperties } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { measureElement, useVirtualizer } from "@tanstack/react-virtual";
import { buildCommitGraph } from "../../lib/commitGraph";
import { getCommitGraphWidth } from "./CommitGraph";
import { CommitListView } from "./CommitListView";
import { HistoryEmptyView, HistoryLoadingView } from "./CommitListStateViews";
import { ReflogListView, type ReflogMenu } from "./ReflogListView";
import type { VirtualCommitListProps } from "./CommitListTypes";

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
}: VirtualCommitListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledCommitRef = useRef<string | null>(null);
  const lastScrolledReflogRef = useRef<string | null>(null);
  const [reflogMenu, setReflogMenu] = useState<ReflogMenu | null>(null);
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
        24,
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
      <HistoryLoadingView
        activeCommit={activeCommit}
        branch={branch}
        filter={activeFilter}
        gitWriteActions={gitWriteActions}
        historyMode={historyMode}
        isReflogMode={isReflogMode}
        tableStyle={tableStyle}
        onChangeFilter={isReflogMode ? onChangeReflogFilter : onChangeFilter}
        onChangeHistoryMode={onChangeHistoryMode}
        onSelectWorkingTree={onSelectWorkingTree}
      />
    );
  }

  if (!isReflogMode && graphRows.length === 0) {
    return (
      <HistoryEmptyView
        activeCommit={activeCommit}
        branch={branch}
        filter={filter}
        gitWriteActions={gitWriteActions}
        historyMode={historyMode}
        message="No commits match the current filter."
        tableClassName="commit-table"
        tableStyle={tableStyle}
        onChangeFilter={onChangeFilter}
        onChangeHistoryMode={onChangeHistoryMode}
        onSelectWorkingTree={onSelectWorkingTree}
      />
    );
  }

  if (isReflogMode && reflogEntries.length === 0) {
    return (
      <HistoryEmptyView
        activeCommit={activeCommit}
        branch={branch}
        filter={reflogFilter}
        gitWriteActions={gitWriteActions}
        historyMode={historyMode}
        message="No reflog entries match the current filter."
        tableClassName="reflog-table"
        tableStyle={tableStyle}
        onChangeFilter={onChangeReflogFilter}
        onChangeHistoryMode={onChangeHistoryMode}
        onSelectWorkingTree={onSelectWorkingTree}
      />
    );
  }

  if (isReflogMode) {
    return (
      <ReflogListView
        activeCommit={activeCommit}
        activeReflogSelector={activeReflogSelector}
        branch={branch}
        filter={reflogFilter}
        gitWriteActions={gitWriteActions}
        reflogEntries={reflogEntries}
        reflogMenu={reflogMenu}
        scrollRef={scrollRef}
        tableStyle={tableStyle}
        virtualizer={reflogVirtualizer}
        onChangeFilter={onChangeReflogFilter}
        onChangeHistoryMode={onChangeHistoryMode}
        onRestoreReflogEntry={onRestoreReflogEntry}
        onSelectReflogEntry={onSelectReflogEntry}
        onSelectWorkingTree={onSelectWorkingTree}
        onSetReflogMenu={setReflogMenu}
      />
    );
  }

  return (
    <CommitListView
      activeCommit={activeCommit}
      branch={branch}
      filter={filter}
      gitWriteActions={gitWriteActions}
      graphRows={graphRows}
      scrollRef={scrollRef}
      tableStyle={tableStyle}
      virtualizer={commitVirtualizer}
      onChangeFilter={onChangeFilter}
      onChangeHistoryMode={onChangeHistoryMode}
      onSelectCommit={onSelectCommit}
      onSelectWorkingTree={onSelectWorkingTree}
    />
  );
}
