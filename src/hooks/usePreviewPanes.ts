import { useCallback, useMemo, useRef, useState } from "react";
import {
  activatePreviewPane,
  activatePreviewPaneTab,
  activePreviewPane,
  activePreviewPaneTab,
  clearPreviewPaneLayout,
  createPreviewPaneLayout,
  movePreviewPaneTabPath,
  openPreviewPaneTab,
  primaryPreviewPaneId,
  removePreviewPaneTabsForPath,
  reorderPreviewPaneTabs,
  showPreviewPaneDiffSelection,
  splitPreviewPaneTab,
  splitPreviewPaneTabWithDestination,
  type PreviewPaneId,
  type PreviewPaneLayout,
  type PreviewSplitDirection,
} from "../lib/previewPanes";
import {
  createTerminalPreviewTab,
  restoreTerminalPreviewTabs,
  type TerminalPreviewTabLifecycle,
} from "../lib/previewPaneTerminalTabs";
import {
  type FilePreviewMode,
  type PreviewMode,
  type PreviewTab,
  type PreviewTarget,
  isTerminalPreviewTab,
  previewTabId,
} from "../lib/previewTabs";
import { addTerminalTab, getTerminalWorkspace } from "../lib/terminalSessions";
import { dockTerminalTabToEditor } from "../lib/terminalTabPlacement";
import type {
  PreviewPanesController,
  UsePreviewPanesOptions,
} from "./previewPaneHookTypes";
import { usePreviewPaneCloseActions } from "./usePreviewPaneCloseActions";
import { usePreviewPaneDirtyGuard } from "./usePreviewPaneDirtyGuard";

export function usePreviewPanes({
  activeCommit,
  activeProjectPath,
  editorDrafts,
  onCloseTerminalTab,
  onDiscardDraft,
  onRestoreTerminalTab,
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
  const terminalLifecycle = useMemo<TerminalPreviewTabLifecycle>(
    () => ({ close: onCloseTerminalTab, restore: onRestoreTerminalTab }),
    [onCloseTerminalTab, onRestoreTerminalTab],
  );

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
      mode: FilePreviewMode,
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

  const openTerminalTab = useCallback(
    (
      paneId: PreviewPaneId,
      projectPath: string,
      terminalTabId: string,
      title: string,
    ) => {
      const tab = createTerminalPreviewTab(projectPath, terminalTabId, title);
      applyLayout(openPreviewPaneTab(layout, paneId, tab, null));
    },
    [applyLayout, layout],
  );

  const splitTab = useCallback(
    (
      paneId: PreviewPaneId,
      tabId: string,
      direction: PreviewSplitDirection,
    ) => {
      const nextPaneId = `preview-pane-${paneIdCounterRef.current + 1}`;
      paneIdCounterRef.current += 1;
      const sourcePane = layout.panes.find((pane) => pane.id === paneId);
      const sourceTab = sourcePane?.tabs.find((tab) => tab.id === tabId) ?? null;
      if (!isTerminalPreviewTab(sourceTab)) {
        applyLayout(splitPreviewPaneTab(layout, paneId, tabId, direction, nextPaneId));
        return;
      }

      const sourceTerminalTab =
        getTerminalWorkspace(sourceTab.projectPath).tabs.find(
          (tab) => tab.id === sourceTab.terminalTabId,
        ) ?? null;
      const cwd = sourceTerminalTab?.cwd ?? sourceTerminalTab?.session?.cwd ?? null;
      const destinationTerminalTab = addTerminalTab(sourceTab.projectPath, cwd);
      dockTerminalTabToEditor(sourceTab.projectPath, destinationTerminalTab.id);
      const destinationTab = createTerminalPreviewTab(
        sourceTab.projectPath,
        destinationTerminalTab.id,
        destinationTerminalTab.title,
      );
      applyLayout(
        splitPreviewPaneTabWithDestination(
          layout,
          paneId,
          tabId,
          direction,
          nextPaneId,
          destinationTab,
        ),
      );
    },
    [applyLayout, layout],
  );

  const {
    closeActivePreviewTab,
    closeAllTabs,
    closeOtherTabs,
    closePreviewTab,
  } = usePreviewPaneCloseActions({
    activePane,
    applyLayout,
    confirmDiscardClosedDirtyTabs,
    layout,
    terminalLifecycle,
  });

  const clearPreviewTabs = useCallback(
    (mode: PreviewMode = "file") => {
      restoreTerminalPreviewTabs(layout, terminalLifecycle);
      applyLayout(clearPreviewPaneLayout(mode));
    },
    [applyLayout, layout, terminalLifecycle],
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
    openTerminalTab,
    openPreviewTab,
    removePreviewTabsForPath,
    reorderPreviewTabs,
    showDiffSelection,
    splitTab,
  };
}
