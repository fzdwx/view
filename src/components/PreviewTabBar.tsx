import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from "react";
import { Loader2 } from "lucide-react";
import appIcon from "../assets/icon.svg";
import { fileNameFromPath } from "../lib/pathLabels";
import type { PreviewMode, PreviewTab } from "../lib/previewTabs";
import { ProjectTreeTitle } from "./ProjectTreeTitle";
import { TabContextMenu } from "./TabContextMenu";
import { PreviewTabItem } from "./PreviewTabItem";
import { WindowControls } from "./WindowControls";

interface PreviewTabBarProps {
  readonly activeTabId: string | null;
  readonly diffStats: {
    readonly additions: number;
    readonly deletions: number;
    readonly files: number;
  };
  readonly dirtyTabIds: Set<string>;
  readonly loading: boolean;
  readonly onCloseTab: (tabId: string) => void;
  readonly onCloseOtherTabs: (tabId: string) => void;
  readonly onCloseAllTabs: () => void;
  readonly onReorderTabs: (fromId: string, toId: string) => void;
  readonly onSelectTab: (tab: PreviewTab) => void;
  readonly onSplitDown?: (tab: PreviewTab) => void;
  readonly onSplitRight?: (tab: PreviewTab) => void;
  readonly previewMode: PreviewMode;
  readonly projectPath: string | null;
  readonly selectedPath: string | null;
  readonly tabs: readonly PreviewTab[];
  readonly variant?: "app" | "pane";
}

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
  onSplitDown,
  onSplitRight,
  previewMode,
  projectPath,
  selectedPath,
  tabs,
  variant = "app",
}: PreviewTabBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isPane = variant === "pane";
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

  function handleTabDragStart(event: DragEvent, tabId: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", tabId);
    setDragTabId(tabId);
  }

  function handleTabDragOver(event: DragEvent, tabId: string) {
    if (!dragTabId || dragTabId === tabId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverTabId(tabId);
  }

  function handleTabDrop(event: DragEvent, tabId: string) {
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

  function handleAuxClick(event: MouseEvent, tabId: string) {
    if (event.button === 1) {
      event.preventDefault();
      onCloseTab(tabId);
    }
  }

  function handleContextMenu(
    event: MouseEvent,
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

  function handleSplitRight(tab: PreviewTab) {
    onSplitRight?.(tab);
    setContextMenu(null);
  }

  function handleSplitDown(tab: PreviewTab) {
    onSplitDown?.(tab);
    setContextMenu(null);
  }

  return (
    <div
      className={isPane ? "preview-tabbar preview-tabbar-pane" : "preview-tabbar"}
      data-tauri-drag-region={isPane ? undefined : ""}
    >
      {projectPath && !isPane ? (
        <div
          className="preview-tabbar-path"
          data-tauri-drag-region={isPane ? undefined : ""}
        >
          <span className="brand-mark">
            <img className="brand-mark-icon" src={appIcon} alt="" draggable={false} />
          </span>
          <ProjectTreeTitle path={projectPath} />
        </div>
      ) : null}
      <div
        ref={scrollRef}
        className={scrollClassName}
        data-tauri-drag-region={isPane ? undefined : ""}
        role="tablist"
        aria-label="Open files"
        onScroll={updateScrollState}
      >
        {tabs.length > 0 ? (
          tabs.map((tab) => {
            return (
              <PreviewTabItem
                key={tab.id}
                active={tab.id === activeTabId}
                dirty={dirtyTabIds.has(tab.id)}
                dragging={dragTabId === tab.id}
                dragOver={dragOverTabId === tab.id && dragTabId !== tab.id}
                tab={tab}
                onAuxClick={handleAuxClick}
                onClose={onCloseTab}
                onContextMenu={handleContextMenu}
                onDragEnd={handleTabDragEnd}
                onDragOver={handleTabDragOver}
                onDragStart={handleTabDragStart}
                onDrop={handleTabDrop}
                onSelect={onSelectTab}
              />
            );
          })
        ) : selectedPath ? (
          <div
            className="preview-tab-placeholder"
            data-tauri-drag-region={isPane ? undefined : ""}
          >
            {`${previewMode === "diff" ? "Diff" : "File"}: ${fileNameFromPath(
              selectedPath,
            )}`}
          </div>
        ) : null}
      </div>
      <div
        className="preview-tabbar-meta"
        data-tauri-drag-region={isPane ? undefined : ""}
      >
        {previewMode === "diff" && diffStats.files > 0 ? (
          <div className="diff-stat-strip" aria-label="Diff line counts">
            <span className="addition">+{diffStats.additions}</span>
            <span className="deletion">-{diffStats.deletions}</span>
          </div>
        ) : null}
        {loading ? <Loader2 className="spin" size={15} /> : null}
        {isPane ? null : <WindowControls />}
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
          onSplitRight={
            onSplitRight
              ? () => handleSplitRight(contextMenu.tab)
              : undefined
          }
          onSplitDown={
            onSplitDown
              ? () => handleSplitDown(contextMenu.tab)
              : undefined
          }
        />
      ) : null}
    </div>
  );
}
