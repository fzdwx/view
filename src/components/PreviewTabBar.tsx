import { useCallback, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { fileNameFromPath } from "../lib/pathLabels";
import type { PreviewMode, PreviewTab } from "../lib/previewTabs";

export function PreviewTabBar({
  activeTabId,
  diffStats,
  dirtyTabIds,
  loading,
  onCloseTab,
  onDragEnd,
  onDragStart,
  onSelectTab,
  previewMode,
  selectedPath,
  tabs,
}: {
  activeTabId: string | null;
  diffStats: { additions: number; deletions: number; files: number };
  dirtyTabIds: Set<string>;
  loading: boolean;
  onCloseTab(tabId: string): void;
  onDragEnd(): void;
  onDragStart(): void;
  onSelectTab(tab: PreviewTab): void;
  previewMode: PreviewMode;
  selectedPath: string | null;
  tabs: PreviewTab[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({
    canScrollLeft: false,
    canScrollRight: false,
  });

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollState({
      canScrollLeft: el.scrollLeft > 2,
      canScrollRight: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    });
  }, []);

  const scrollClassName = [
    "preview-tabs",
    scrollState.canScrollLeft ? "scroll-left" : "",
    scrollState.canScrollRight ? "scroll-right" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="preview-tabbar">
      <div
        ref={scrollRef}
        className={scrollClassName}
        role="tablist"
        aria-label="Open files"
        onScroll={updateScrollState}
      >
        {tabs.length > 0 ? (
          tabs.map((tab) => (
            <div
              key={tab.id}
              className={
                tab.id === activeTabId ? "preview-tab active" : "preview-tab"
              }
              title={tab.path}
            >
              <button
                className="preview-tab-select"
                role="tab"
                aria-selected={tab.id === activeTabId}
                onClick={() => onSelectTab(tab)}
              >
                <span
                  className={
                    tab.mode === "diff"
                      ? "preview-tab-kind diff"
                      : "preview-tab-kind"
                  }
                >
                  {tab.mode === "diff" ? "D" : "F"}
                </span>
                <span className="preview-tab-name">
                  {fileNameFromPath(tab.path)}
                </span>
                {dirtyTabIds.has(tab.id) ? (
                  <span className="preview-tab-dirty" aria-label="Unsaved changes" />
                ) : null}
              </button>
              <button
                className={
                  dirtyTabIds.has(tab.id)
                    ? "preview-tab-close preview-tab-close-dirty"
                    : "preview-tab-close"
                }
                aria-label={`Close ${tab.path}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))
        ) : (
          <div className="preview-tab-placeholder">
            {selectedPath
              ? `${previewMode === "diff" ? "Diff" : "File"}: ${fileNameFromPath(
                  selectedPath,
                )}`
              : "No file open"}
          </div>
        )}
      </div>
      <div className="preview-tabbar-meta">
        <div
          className="editor-dock-handle"
          draggable
          title="Drag editor group"
          onDragEnd={onDragEnd}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("application/x-view-panel", "editor");
            onDragStart();
          }}
        >
          Editor
        </div>
        {previewMode === "diff" && diffStats.files > 0 ? (
          <div className="diff-stat-strip" aria-label="Diff line counts">
            <span className="addition">+{diffStats.additions}</span>
            <span className="deletion">-{diffStats.deletions}</span>
          </div>
        ) : null}
        {loading ? <Loader2 className="spin" size={15} /> : null}
      </div>
    </div>
  );
}
