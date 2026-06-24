import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
} from "react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  GitBranch,
  Search,
  Tag,
} from "lucide-react";
import { usePanelResizeDeferredValue } from "../../hooks/usePanelResizeDeferredValue";
import type { BranchInfo, TagInfo } from "../../lib/api";
import type { BranchActionKind } from "../../lib/branchModels";
import {
  buildBranchTreeRows,
  filterRefs,
  refRowSectionTitle,
  type RefLeaf,
  type RefSectionId,
  type VirtualRefRow,
} from "../../lib/branchTree";
import {
  panelResizeEndEvent,
  runAfterPanelResizeIdle,
} from "../../lib/panelResizeInteraction";
import { measureElementUnlessPanelResizing } from "../../lib/virtualizerMeasurement";
import { BranchContextMenu } from "./BranchContextMenu";

const BRANCH_HEAD_ROW_ESTIMATE = 32;
const BRANCH_SECTION_ROW_ESTIMATE = 28;
const BRANCH_ITEM_ROW_ESTIMATE = 28;

type BranchMenuState = {
  readonly branch: BranchInfo;
  readonly left: number;
  readonly top: number;
};

export const BranchTree = memo(function BranchTree({
  branches,
  tags,
  activeRef,
  onBranchAction,
  onSelect,
}: {
  branches: BranchInfo[];
  tags: TagInfo[];
  activeRef: string | null;
  onBranchAction(action: BranchActionKind, branch: BranchInfo): void;
  onSelect(refName: string): void;
}) {
  const [branchFilter, setBranchFilter] = useState("");
  const [branchMenu, setBranchMenu] = useState<BranchMenuState | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const [collapsedBranchSections, setCollapsedBranchSections] = useState<
    Set<Exclude<RefSectionId, "tags">>
  >(() => new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledRef = useRef<string | null>(null);
  const deferredBranches = usePanelResizeDeferredValue(branches);
  const deferredTags = usePanelResizeDeferredValue(tags);
  const filtering = branchFilter.trim().length > 0;
  const localBranches = useMemo(
    () =>
      filterRefs(
        deferredBranches.filter((branch) => branch.branchType === "local"),
        branchFilter,
      ),
    [branchFilter, deferredBranches],
  );
  const remoteBranches = useMemo(
    () =>
      filterRefs(
        deferredBranches.filter((branch) => branch.branchType === "remote"),
        branchFilter,
      ),
    [branchFilter, deferredBranches],
  );
  const visibleTags = useMemo(
    () => filterRefs(deferredTags, branchFilter),
    [branchFilter, deferredTags],
  );
  const currentBranch =
    deferredBranches.find((branch) => branch.current) ?? null;
  const showCurrentBranch =
    currentBranch !== null && filterRefs([currentBranch], branchFilter).length > 0;
  const refCount = deferredBranches.length + deferredTags.length;
  const visibleRefCount =
    localBranches.length + remoteBranches.length + visibleTags.length;
  const refCountLabel = filtering
    ? `${visibleRefCount} / ${refCount}`
    : `${refCount}`;
  const rows = useMemo(
    () =>
      buildBranchTreeRows({
        currentBranch,
        showCurrentBranch,
        localBranches,
        remoteBranches,
        tags: visibleTags,
        filtering,
        collapsedBranchSections,
        collapsedFolders,
      }),
    [
      collapsedBranchSections,
      collapsedFolders,
      currentBranch,
      filtering,
      localBranches,
      remoteBranches,
      showCurrentBranch,
      visibleTags,
    ],
  );
  const activeIndex = useMemo(
    () => rows.findIndex((row) => isActiveRefRow(row, activeRef)),
    [activeRef, rows],
  );
  const branchVirtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    directDomUpdates: true,
    directDomUpdatesMode: "transform",
    estimateSize: (index) => estimateRefRowSize(rows[index]),
    getItemKey: (index) => rows[index]?.key ?? index,
    measureElement: measureElementUnlessPanelResizing,
    overscan: 14,
    useAnimationFrameWithResizeObserver: true,
  });

  useEffect(() => {
    let pendingMeasure: ReturnType<typeof runAfterPanelResizeIdle> | null = null;
    const measureAfterPanelResize = () => {
      pendingMeasure?.cancel();
      pendingMeasure = runAfterPanelResizeIdle(
        () => {
          pendingMeasure = null;
          branchVirtualizer.measure();
        },
        { idleTimeoutMs: 500, timeoutMs: 32 },
      );
    };
    window.addEventListener(panelResizeEndEvent, measureAfterPanelResize);
    return () => {
      pendingMeasure?.cancel();
      window.removeEventListener(panelResizeEndEvent, measureAfterPanelResize);
    };
  }, [branchVirtualizer]);
  const firstVisibleIndex = branchVirtualizer.range?.startIndex ?? 0;
  const firstVisibleRow = rows[firstVisibleIndex] ?? null;
  const firstVisibleItem = branchVirtualizer
    .getVirtualItems()
    .find((item) => item.index === firstVisibleIndex);
  const stickySectionTitle = firstVisibleRow
    ? refRowSectionTitle(firstVisibleRow)
    : null;
  const hideStickySection =
    firstVisibleRow?.kind === "section" &&
    firstVisibleItem !== undefined &&
    Math.abs((branchVirtualizer.scrollOffset ?? 0) - firstVisibleItem.start) < 12;

  useEffect(() => {
    if (!branchMenu) {
      return;
    }

    const closeMenu = () => setBranchMenu(null);
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
  }, [branchMenu]);

  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [branchFilter]);

  useEffect(() => {
    if (!activeRef) {
      lastScrolledRef.current = null;
      return;
    }
    if (activeIndex < 0 || lastScrolledRef.current === activeRef) {
      return;
    }
    branchVirtualizer.scrollToIndex(activeIndex, {
      align: "auto",
      behavior: "smooth",
    });
    lastScrolledRef.current = activeRef;
  }, [activeIndex, activeRef, branchVirtualizer]);

  function openBranchMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
    branch: BranchInfo,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setBranchMenu({
      branch,
      left: event.clientX,
      top: event.clientY,
    });
  }

  function executeBranchAction(action: BranchActionKind, branch: BranchInfo) {
    setBranchMenu(null);
    onBranchAction(action, branch);
  }

  function toggleFolder(folderKey: string) {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderKey)) {
        next.delete(folderKey);
      } else {
        next.add(folderKey);
      }
      return next;
    });
  }

  function toggleBranchSection(section: Exclude<RefSectionId, "tags">) {
    setCollapsedBranchSections((current) => {
      const next = new Set(current);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  }

  return (
    <div className="branch-tree">
      <label className="search-field branch-search">
        <Search size={15} />
        <input
          value={branchFilter}
          onChange={(event) => setBranchFilter(event.target.value)}
          placeholder="Filter branches"
        />
        <span className="search-count">{refCountLabel}</span>
      </label>

      <div ref={scrollRef} className="branch-scroll">
        {stickySectionTitle && !hideStickySection ? (
          <div className="branch-sticky-section" aria-hidden="true">
            <span className="branch-sticky-section-label">{stickySectionTitle}</span>
          </div>
        ) : null}
        {rows.length === 0 ? (
          <div className="branch-empty">
            <div className="empty-title">
              {filtering ? "No refs match the current filter" : "No refs available"}
            </div>
            <div className="empty-copy">
              {filtering
                ? "Try another branch, tag, or remote name."
                : "Branches and tags will appear here when the repository exposes them."}
            </div>
          </div>
        ) : (
          <div ref={branchVirtualizer.containerRef} className="branch-virtual-spacer">
            {branchVirtualizer.getVirtualItems().map((virtualItem) => {
              const row = rows[virtualItem.index];
              return (
                <div
                  key={virtualItem.key}
                  className="branch-virtual-row"
                  data-index={virtualItem.index}
                  ref={(node) => {
                    branchVirtualizer.measureElement(node);
                  }}
                >
                  <BranchTreeRow
                    activeRef={activeRef}
                    filtering={filtering}
                    row={row}
                    onBranchContextMenu={openBranchMenu}
                    onSelect={onSelect}
                    onToggleFolder={toggleFolder}
                    onToggleSection={toggleBranchSection}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
      {branchMenu ? (
        <BranchContextMenu
          branch={branchMenu.branch}
          left={branchMenu.left}
          top={branchMenu.top}
          onAction={executeBranchAction}
        />
      ) : null}
    </div>
  );
});

BranchTree.displayName = "BranchTree";

function BranchTreeRow({
  activeRef,
  filtering,
  row,
  onBranchContextMenu,
  onSelect,
  onToggleFolder,
  onToggleSection,
}: {
  activeRef: string | null;
  filtering: boolean;
  row: VirtualRefRow;
  onBranchContextMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
    branch: BranchInfo,
  ): void;
  onSelect(refName: string): void;
  onToggleFolder(folderKey: string): void;
  onToggleSection(section: Exclude<RefSectionId, "tags">): void;
}) {
  switch (row.kind) {
    case "head":
      return (
        <button
          className={row.branch.refName === activeRef ? "branch-head-row active" : "branch-head-row"}
          type="button"
          onClick={() => onSelect(row.branch.refName)}
          onContextMenu={(event) => onBranchContextMenu(event, row.branch)}
        >
          <span className="branch-row-label">HEAD</span>
          <small>{row.branch.name}</small>
        </button>
      );
    case "section":
      if (row.section !== "tags") {
        const collapsed = row.collapsed && !filtering;
        return (
          <button
            className="branch-section-row"
            type="button"
            aria-expanded={!collapsed}
            onClick={() =>
              onToggleSection(row.section as Exclude<RefSectionId, "tags">)
            }
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            <span className="branch-section-title">{row.title}</span>
            <small className="branch-section-count">{row.count}</small>
          </button>
        );
      }
      return (
        <div className="branch-section-row static">
          <ChevronDown size={14} />
          <span className="branch-section-title">{row.title}</span>
          <small className="branch-section-count">{row.count}</small>
        </div>
      );
    case "folder":
      return (
        <button
          className="branch-folder-row"
          type="button"
          style={{ "--branch-depth": row.depth } as CSSProperties}
          aria-expanded={!row.collapsed}
          onClick={() => onToggleFolder(row.folderKey)}
        >
          {row.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          <Folder size={13} />
          <span className="branch-row-label">{row.name}</span>
        </button>
      );
    case "branch":
      return (
        <button
          className={row.branch.refName === activeRef ? "branch-row active" : "branch-row"}
          type="button"
          style={{ "--branch-depth": row.depth } as CSSProperties}
          onClick={() => onSelect(row.branch.refName)}
          onContextMenu={(event) => onBranchContextMenu(event, row.branch)}
        >
          <GitBranch size={13} />
          <span className="branch-row-label">{row.branch.name}</span>
          <BranchTrackingBadge branch={row.branch} />
        </button>
      );
    case "tag":
      return (
        <button
          type="button"
          className={row.tag.refName === activeRef ? "branch-row active" : "branch-row"}
          style={{ "--branch-depth": row.depth } as CSSProperties}
          onClick={() => onSelect(row.tag.refName)}
        >
          <Tag size={13} />
          <span className="branch-row-label">{row.tag.name}</span>
        </button>
      );
  }
}

function BranchTrackingBadge({ branch }: { branch: RefLeaf }) {
  const hasAhead = Boolean(branch.ahead && branch.ahead > 0);
  const hasBehind = Boolean(branch.behind && branch.behind > 0);
  const otherLabel = branch.branchType === "remote" ? "remote" : "upstream";

  if (branch.current || hasAhead || hasBehind) {
    return (
      <small className="branch-badges">
        {hasBehind ? (
          <span className="branch-behind" title={`${otherLabel} has commits not in local`}>
            ↙ {branch.behind}
          </span>
        ) : null}
        {hasAhead ? (
          <span className="branch-ahead" title={`Local has commits not in ${otherLabel}`}>
            ↗ {branch.ahead}
          </span>
        ) : null}
        {branch.current ? <span className="branch-head-badge">HEAD</span> : null}
      </small>
    );
  }

  return null;
}

function estimateRefRowSize(row: VirtualRefRow | undefined) {
  if (!row) {
    return BRANCH_ITEM_ROW_ESTIMATE;
  }

  switch (row.kind) {
    case "head":
      return BRANCH_HEAD_ROW_ESTIMATE;
    case "section":
      return BRANCH_SECTION_ROW_ESTIMATE;
    default:
      return BRANCH_ITEM_ROW_ESTIMATE;
  }
}

function isActiveRefRow(row: VirtualRefRow, activeRef: string | null) {
  if (!activeRef) {
    return false;
  }

  switch (row.kind) {
    case "head":
      return row.branch.refName === activeRef;
    case "branch":
      return row.branch.refName === activeRef;
    case "tag":
      return row.tag.refName === activeRef;
    default:
      return false;
  }
}
