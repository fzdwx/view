import { useCallback, useEffect, useRef, useState } from "react";
import { GitCompare, Loader2, X } from "lucide-react";
import appIcon from "../assets/icon.svg";
import { fileNameFromPath } from "../lib/pathLabels";
import { useFileIcon } from "../lib/fileIcons";
import type { PreviewMode, PreviewTab } from "../lib/previewTabs";
import { ProjectTreeTitle } from "./ProjectTreeTitle";
import { TabContextMenu } from "./TabContextMenu";
import { WindowControls } from "./WindowControls";

export function PreviewTabBar({
  activeTabId,
  diffStats,
  dirtyTabIds,
  loading,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  onReorderTabs,
  onSelectTab,
  previewMode,
  projectPath,
  selectedPath,
  tabs,
}: {
  activeTabId: string | null;
  diffStats: { additions: number; deletions: number; files: number };
  dirtyTabIds: Set<string>;
  loading: boolean;
  onCloseTab(tabId: string): void;
  onCloseOtherTabs(tabId: string): void;
  onCloseAllTabs(): void;
  onReorderTabs(fromId: string, toId: string): void;
  onSelectTab(tab: PreviewTab): void;
  previewMode: PreviewMode;
  projectPath: string | null;
  selectedPath: string | null;
  tabs: PreviewTab[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({
    canScrollLeft: false,
    canScrollRight: false,
  });
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    tab: PreviewTab;
    left: number;
    top: number;
  } | null>(null);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollState({
      canScrollLeft: el.scrollLeft > 2,
      canScrollRight: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    function closeMenu() {
      setContextMenu(null);
    }
    window.addEventListener("click", closeMenu);
    window.addEventListener("blur", closeMenu);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("blur", closeMenu);
    };
  }, [contextMenu]);

  const scrollClassName = [
    "preview-tabs",
    scrollState.canScrollLeft ? "scroll-left" : "",
    scrollState.canScrollRight ? "scroll-right" : "",
  ]
    .filter(Boolean)
    .join(" ");

  function handleTabDragStart(event: React.DragEvent, tabId: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", tabId);
    setDragTabId(tabId);
  }

  function handleTabDragOver(event: React.DragEvent, tabId: string) {
    if (!dragTabId || dragTabId === tabId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverTabId(tabId);
  }

  function handleTabDrop(event: React.DragEvent, tabId: string) {
    event.preventDefault();
    if (dragTabId && dragTabId !== tabId) {
      onReorderTabs(dragTabId, tabId);
    }
    setDragTabId(null);
    setDragOverTabId(null);
  }

  function handleTabDragEnd() {
    setDragTabId(null);
    setDragOverTabId(null);
  }

  function handleAuxClick(event: React.MouseEvent, tabId: string) {
    if (event.button === 1) {
      event.preventDefault();
      onCloseTab(tabId);
    }
  }

  function handleContextMenu(
    event: React.MouseEvent,
    tab: PreviewTab,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ tab, left: event.clientX, top: event.clientY });
  }

  function handleCopyPath(tab: PreviewTab) {
    void navigator.clipboard?.writeText(tab.path);
    setContextMenu(null);
  }

  return (
    <div className="preview-tabbar" data-tauri-drag-region>
      {projectPath ? (
        <div className="preview-tabbar-path" data-tauri-drag-region>
          <span className="brand-mark">
            <img className="brand-mark-icon" src={appIcon} alt="" draggable={false} />
          </span>
          <ProjectTreeTitle path={projectPath} />
        </div>
      ) : null}
      <div
        ref={scrollRef}
        className={scrollClassName}
        data-tauri-drag-region
        role="tablist"
        aria-label="Open files"
        onScroll={updateScrollState}
      >
        {tabs.length > 0 ? (
          tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const isDirty = dirtyTabIds.has(tab.id);
            const isDragging = dragTabId === tab.id;
            const isDragOver = dragOverTabId === tab.id && dragTabId !== tab.id;
            return (
              <div
                key={tab.id}
                className={[
                  isActive ? "preview-tab active" : "preview-tab",
                  isDragging ? "dragging" : "",
                  isDragOver ? "drag-over" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                title={tab.path}
                draggable
                onDragStart={(e) => handleTabDragStart(e, tab.id)}
                onDragOver={(e) => handleTabDragOver(e, tab.id)}
                onDrop={(e) => handleTabDrop(e, tab.id)}
                onDragEnd={handleTabDragEnd}
                onAuxClick={(e) => handleAuxClick(e, tab.id)}
                onContextMenu={(e) => handleContextMenu(e, tab)}
              >
                <button
                  type="button"
                  className="preview-tab-select"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onSelectTab(tab)}
                >
                  <span
                    className={
                      tab.mode === "diff"
                        ? "preview-tab-kind diff"
                        : "preview-tab-kind"
                    }
                  >
                    {tab.mode === "diff" ? (
                      <GitCompare size={11} />
                    ) : (
                      <TabFileIcon path={tab.path} />
                    )}
                  </span>
                  <span className="preview-tab-name">
                    {fileNameFromPath(tab.path)}
                  </span>
                  {isDirty ? (
                    <span
                      className="preview-tab-dirty"
                      aria-label="Unsaved changes"
                    />
                  ) : null}
                </button>
                <button
                  type="button"
                  className={
                    isDirty
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
            );
          })
        ) : selectedPath ? (
          <div className="preview-tab-placeholder" data-tauri-drag-region>
            {`${previewMode === "diff" ? "Diff" : "File"}: ${fileNameFromPath(
              selectedPath,
            )}`}
          </div>
        ) : null}
      </div>
      <div className="preview-tabbar-meta" data-tauri-drag-region>
        {previewMode === "diff" && diffStats.files > 0 ? (
          <div className="diff-stat-strip" aria-label="Diff line counts">
            <span className="addition">+{diffStats.additions}</span>
            <span className="deletion">-{diffStats.deletions}</span>
          </div>
        ) : null}
        {loading ? <Loader2 className="spin" size={15} /> : null}
        <WindowControls />
      </div>
      {contextMenu ? (
        <TabContextMenu
          left={contextMenu.left}
          top={contextMenu.top}
          onClose={() => {
            onCloseTab(contextMenu.tab.id);
            setContextMenu(null);
          }}
          onCloseOthers={() => {
            onCloseOtherTabs(contextMenu.tab.id);
            setContextMenu(null);
          }}
          onCloseAll={() => {
            onCloseAllTabs();
            setContextMenu(null);
          }}
          onCopyPath={() => handleCopyPath(contextMenu.tab)}
        />
      ) : null}
    </div>
  );
}

function TabFileIcon({ path }: { path: string }) {
  const icon = useFileIcon(path);
  return (
    <svg
      width={14}
      height={14}
      viewBox={icon.viewBox ?? "0 0 16 16"}
      className="preview-tab-file-icon"
      style={{ color: icon.color }}
      aria-hidden="true"
    >
      <use href={`#${icon.name}`} />
    </svg>
  );
}
