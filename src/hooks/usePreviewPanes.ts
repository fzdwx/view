import { useCallback, useRef, useState } from "react";
import {
  activatePreviewPane,
  activatePreviewPaneTab,
  activePreviewPane,
  activePreviewPaneTab,
  clearPreviewPaneLayout,
  closeAllPreviewPaneTabs,
  closeOtherPreviewPaneTabs,
  closePreviewPaneTab,
  createPreviewPaneLayout,
  movePreviewPaneTabPath,
  openPreviewPaneTab,
  primaryPreviewPaneId,
  removePreviewPaneTabsForPath,
  reorderPreviewPaneTabs,
  showPreviewPaneDiffSelection,
  splitPreviewPaneTab,
  type PreviewPaneId,
  type PreviewPaneLayout,
  type PreviewSplitDirection,
} from "../lib/previewPanes";
import {
  type PreviewMode,
  type PreviewTab,
  type PreviewTarget,
  previewTabId,
} from "../lib/previewTabs";
import type {
  PreviewPanesController,
  UsePreviewPanesOptions,
} from "./previewPaneHookTypes";
import { usePreviewPaneDirtyGuard } from "./usePreviewPaneDirtyGuard";

export function usePreviewPanes({
  activeCommit,
  activeProjectPath,
  editorDrafts,
  onDiscardDraft,
  onSelectChangePath,
  onSelectCommit,
  onSelectProjectPath,
}: UsePreviewPanesOptions): PreviewPanesController {
  const [layout, setLayout] = useState(createPreviewPaneLayout);
  const targetRequestIdRef = useRef(0);
  const paneIdCounterRef = useRef(1);
  const activePane = activePreviewPane(layout);
  const activePreviewTab = activePane ? activePreviewPaneTab(activePane) : null;
  const previewTabs = activePane?.tabs ?? [];
  const activePreviewTabId = activePane?.activeTabId ?? null;
  const previewMode = activePane?.mode ?? "file";
  const previewTarget = activePane?.target ?? null;
  const { confirmDiscardClosedDirtyTabs, dirtyPreviewTabIds } =
    usePreviewPaneDirtyGuard({
      activeProjectPath,
      editorDrafts,
      layout,
      onDiscardDraft,
    });

  const syncSelection = useCallback(
    (nextLayout: PreviewPaneLayout) => {
      const pane = activePreviewPane(nextLayout);
      const tab = pane ? activePreviewPaneTab(pane) : null;
      if (tab?.mode === "file") {
        onSelectProjectPath(tab.path);
        onSelectChangePath(null);
        return;
      }
      if (tab?.mode === "diff") {
        onSelectProjectPath(null);
        onSelectCommit(tab.commit);
        onSelectChangePath(tab.path);
        return;
      }
      onSelectProjectPath(null);
      onSelectChangePath(null);
    },
    [onSelectChangePath, onSelectCommit, onSelectProjectPath],
  );

  const applyLayout = useCallback(
    (nextLayout: PreviewPaneLayout) => {
      setLayout(nextLayout);
      syncSelection(nextLayout);
    },
    [syncSelection],
  );

  const activatePane = useCallback(
    (paneId: PreviewPaneId) => {
      const nextLayout = activatePreviewPane(layout, paneId);
      applyLayout(nextLayout);
    },
    [applyLayout, layout],
  );

  const activatePreviewTab = useCallback(
    (paneId: PreviewPaneId, tab: PreviewTab) => {
      applyLayout(activatePreviewPaneTab(layout, paneId, tab.id));
    },
    [applyLayout, layout],
  );

  const openPreviewTab = useCallback(
    (
      mode: PreviewMode,
      path: string,
      targetLine: number | null = null,
      targetColumn: number | null = null,
    ) => {
      const commit = mode === "diff" ? activeCommit : null;
      const tab = { id: previewTabId(mode, path, commit), mode, path, commit };
      const paneId = activePane?.id ?? primaryPreviewPaneId;
      const target =
        mode === "file" && targetLine && targetLine > 0
          ? {
              line: targetLine,
              column: targetColumn ?? 0,
              requestId: ++targetRequestIdRef.current,
            }
          : null;
      applyLayout(openPreviewPaneTab(layout, paneId, tab, target));
    },
    [activeCommit, activePane?.id, applyLayout, layout],
  );

  const splitTab = useCallback(
    (
      paneId: PreviewPaneId,
      tabId: string,
      direction: PreviewSplitDirection,
    ) => {
      const nextPaneId = `preview-pane-${paneIdCounterRef.current + 1}`;
      paneIdCounterRef.current += 1;
      applyLayout(splitPreviewPaneTab(layout, paneId, tabId, direction, nextPaneId));
    },
    [applyLayout, layout],
  );

  const closePreviewTab = useCallback(
    (paneId: PreviewPaneId, tabId: string) => {
      const pane = layout.panes.find((current) => current.id === paneId);
      const removedTab = pane?.tabs.find((tab) => tab.id === tabId) ?? null;
      const nextLayout = closePreviewPaneTab(layout, paneId, tabId);
      if (
        removedTab &&
        confirmDiscardClosedDirtyTabs([removedTab], nextLayout)
      ) {
        applyLayout(nextLayout);
      }
    },
    [applyLayout, confirmDiscardClosedDirtyTabs, layout],
  );

  const closeOtherTabs = useCallback(
    (paneId: PreviewPaneId, keepTabId: string) => {
      const pane = layout.panes.find((current) => current.id === paneId);
      const removedTabs = pane?.tabs.filter((tab) => tab.id !== keepTabId) ?? [];
      const nextLayout = closeOtherPreviewPaneTabs(layout, paneId, keepTabId);
      if (confirmDiscardClosedDirtyTabs(removedTabs, nextLayout)) {
        applyLayout(nextLayout);
      }
    },
    [applyLayout, confirmDiscardClosedDirtyTabs, layout],
  );

  const closeAllTabs = useCallback(
    (paneId: PreviewPaneId) => {
      const pane = layout.panes.find((current) => current.id === paneId);
      const nextLayout = closeAllPreviewPaneTabs(layout, paneId);
      if (confirmDiscardClosedDirtyTabs(pane?.tabs ?? [], nextLayout)) {
        applyLayout(nextLayout);
      }
    },
    [applyLayout, confirmDiscardClosedDirtyTabs, layout],
  );

  const closeActivePreviewTab = useCallback(() => {
    if (activePane?.activeTabId) {
      closePreviewTab(activePane.id, activePane.activeTabId);
    }
  }, [activePane, closePreviewTab]);

  const clearPreviewTabs = useCallback(
    (mode: PreviewMode = "file") => applyLayout(clearPreviewPaneLayout(mode)),
    [applyLayout],
  );

  const showDiffSelection = useCallback(() => {
    const paneId = activePane?.id ?? primaryPreviewPaneId;
    applyLayout(showPreviewPaneDiffSelection(layout, paneId));
  }, [activePane?.id, applyLayout, layout]);

  const movePreviewTabPath = useCallback(
    (fromPath: string, toPath: string) => {
      const toTab = {
        id: previewTabId("file", toPath, null),
        mode: "file",
        path: toPath,
        commit: null,
      } satisfies PreviewTab;
      applyLayout(movePreviewPaneTabPath(layout, fromPath, toTab));
    },
    [applyLayout, layout],
  );

  const removePreviewTabsForPath = useCallback(
    (path: string) => {
      applyLayout(removePreviewPaneTabsForPath(layout, path));
    },
    [applyLayout, layout],
  );

  const reorderPreviewTabs = useCallback(
    (paneId: PreviewPaneId, fromId: string, toId: string) => {
      setLayout(reorderPreviewPaneTabs(layout, paneId, fromId, toId));
    },
    [layout],
  );

  const activateAdjacentTab = useCallback(
    (direction: 1 | -1) => {
      if (!activePane || !activePane.activeTabId || activePane.tabs.length === 0) {
        return;
      }

      const currentIndex = activePane.tabs.findIndex(
        (tab) => tab.id === activePane.activeTabId,
      );
      if (currentIndex < 0) {
        return;
      }

      const count = activePane.tabs.length;
      const nextIndex = (currentIndex + direction + count) % count;
      const nextTab = activePane.tabs[nextIndex];
      if (nextTab) {
        applyLayout(activatePreviewPaneTab(layout, activePane.id, nextTab.id));
      }
    },
    [activePane, applyLayout, layout],
  );

  return {
    activePane,
    activePaneId: activePane?.id ?? primaryPreviewPaneId,
    activePreviewTab,
    activePreviewTabId,
    dirtyPreviewTabIds,
    layout,
    previewMode,
    previewTabs,
    previewTarget,
    activateAdjacentTab,
    activatePane,
    activatePreviewTab,
    clearPreviewTabs,
    closeActivePreviewTab,
    closeAllTabs,
    closeOtherTabs,
    closePreviewTab,
    movePreviewTabPath,
    openPreviewTab,
    removePreviewTabsForPath,
    reorderPreviewTabs,
    showDiffSelection,
    splitTab,
  };
}
