import type { CSSProperties } from "react";
import {
  memo,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { usePanelResizeDeferredValue } from "../../hooks/usePanelResizeDeferredValue";
import { buildCommitGraph } from "../../lib/commitGraph";
import {
  commitGraphWidthRows,
  getCommitGraphColumnWidth,
} from "../../lib/commitGraphLayout";
import {
  measureElementByEstimate,
  observeElementRectDuringPanelResize,
} from "../../lib/virtualizerMeasurement";
import { CommitListView, type CommitMenu } from "./CommitListView";
import { HistoryEmptyView, HistoryLoadingView } from "./CommitListStateViews";
import { ReflogListView, type ReflogMenu } from "./ReflogListView";
import type { VirtualCommitListProps } from "./CommitListTypes";

const COMMIT_ROW_ESTIMATE = 34;
const REFLOG_ROW_ESTIMATE = 34;

export const VirtualCommitList = memo(function VirtualCommitList({
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
  const [commitMenu, setCommitMenu] = useState<CommitMenu | null>(null);
  const [reflogMenu, setReflogMenu] = useState<ReflogMenu | null>(null);
  const isReflogMode = historyMode === "reflog";
  const deferredCommits = usePanelResizeDeferredValue(commits);
  const deferredGraphWidthCommits =
    usePanelResizeDeferredValue(graphWidthCommits);
  const deferredReflogEntries = usePanelResizeDeferredValue(reflogEntries);
  const graphRows = useMemo(
    () => (isReflogMode ? [] : buildCommitGraph(deferredCommits)),
    [deferredCommits, isReflogMode],
  );
  const graphWidthRows = useMemo(
    () => buildCommitGraph(deferredGraphWidthCommits),
    [deferredGraphWidthCommits],
  );
  const hasCommitFilter = !isReflogMode && filter.trim().length > 0;
  const visibleGraphWidthRows = useMemo(
    () =>
      commitGraphWidthRows({
        filteredRows: graphRows,
        fullRows: graphWidthRows,
        hasFilter: hasCommitFilter,
      }),
    [graphRows, graphWidthRows, hasCommitFilter],
  );
  const commitGraphWidth = useMemo(
    () => getCommitGraphColumnWidth(visibleGraphWidthRows),
    [visibleGraphWidthRows],
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
    measureElement: measureElementByEstimate,
    observeElementRect: observeElementRectDuringPanelResize,
    overscan: 18,
    useAnimationFrameWithResizeObserver: true,
  });
  const reflogVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: deferredReflogEntries.length,
    getScrollElement: () => scrollRef.current,
    directDomUpdates: true,
    directDomUpdatesMode: "transform",
    estimateSize: () => REFLOG_ROW_ESTIMATE,
    getItemKey: (index) =>
      `${deferredReflogEntries[index]?.selector ?? index}:${deferredReflogEntries[index]?.hash ?? ""}`,
    measureElement: measureElementByEstimate,
    observeElementRect: observeElementRectDuringPanelResize,
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
        ? deferredReflogEntries.findIndex(
            (entry) => entry.selector === activeReflogSelector,
          )
        : -1,
    [activeReflogSelector, deferredReflogEntries],
  );

  const closeHistoryMenus = useCallback(() => {
    setCommitMenu(null);
    setReflogMenu(null);
  }, []);

  const handleChangeCommitFilter = useCallback(
    (nextFilter: string) => {
      closeHistoryMenus();
      onChangeFilter(nextFilter);
    },
    [closeHistoryMenus, onChangeFilter],
  );

  const handleChangeReflogFilter = useCallback(
    (nextFilter: string) => {
      closeHistoryMenus();
      onChangeReflogFilter(nextFilter);
    },
    [closeHistoryMenus, onChangeReflogFilter],
  );

  const handleChangeHistoryMode = useCallback(
    (mode: "commits" | "reflog") => {
      closeHistoryMenus();
      onChangeHistoryMode(mode);
    },
    [closeHistoryMenus, onChangeHistoryMode],
  );

  const closeHistoryMenusEvent = useEffectEvent(() => {
    if (!commitMenu && !reflogMenu) {
      return;
    }

    setCommitMenu(null);
    setReflogMenu(null);
  });

  useEffect(() => {
    const closeMenu = () => {
      closeHistoryMenusEvent();
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        closeHistoryMenusEvent();
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
  }, []);

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
        onChangeFilter={
          isReflogMode ? handleChangeReflogFilter : handleChangeCommitFilter
        }
        onChangeHistoryMode={handleChangeHistoryMode}
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
        onChangeFilter={handleChangeCommitFilter}
        onChangeHistoryMode={handleChangeHistoryMode}
        onSelectWorkingTree={onSelectWorkingTree}
      />
    );
  }

  if (isReflogMode && deferredReflogEntries.length === 0) {
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
        onChangeFilter={handleChangeReflogFilter}
        onChangeHistoryMode={handleChangeHistoryMode}
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
        reflogEntries={deferredReflogEntries}
        reflogMenu={reflogMenu}
        scrollRef={scrollRef}
        tableStyle={tableStyle}
        virtualizer={reflogVirtualizer}
        onChangeFilter={handleChangeReflogFilter}
        onChangeHistoryMode={handleChangeHistoryMode}
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
      commitMenu={commitMenu}
      filter={filter}
      gitWriteActions={gitWriteActions}
      graphRows={graphRows}
      scrollRef={scrollRef}
      tableStyle={tableStyle}
      virtualizer={commitVirtualizer}
      onChangeFilter={handleChangeCommitFilter}
      onChangeHistoryMode={handleChangeHistoryMode}
      onSelectCommit={onSelectCommit}
      onSelectWorkingTree={onSelectWorkingTree}
      onSetCommitMenu={setCommitMenu}
    />
  );
});

VirtualCommitList.displayName = "VirtualCommitList";
