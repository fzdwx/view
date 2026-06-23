import { useCallback } from "react";
import {
  closeAllPreviewPaneTabs,
  closeOtherPreviewPaneTabs,
  closePreviewPaneTab,
  type PreviewPane,
  type PreviewPaneId,
  type PreviewPaneLayout,
} from "../lib/previewPanes";
import {
  closeTerminalPreviewTabs,
  type TerminalPreviewTabLifecycle,
} from "../lib/previewPaneTerminalTabs";
import type { PreviewTab } from "../lib/previewTabs";

export function usePreviewPaneCloseActions({
  activePane,
  applyLayout,
  confirmDiscardClosedDirtyTabs,
  layout,
  terminalLifecycle,
}: {
  readonly activePane: PreviewPane | null;
  readonly applyLayout: (layout: PreviewPaneLayout) => void;
  readonly confirmDiscardClosedDirtyTabs: (
    removedTabs: readonly PreviewTab[],
    nextLayout: PreviewPaneLayout,
  ) => boolean;
  readonly layout: PreviewPaneLayout;
  readonly terminalLifecycle: TerminalPreviewTabLifecycle;
}) {
  const closePreviewTab = useCallback(
    (paneId: PreviewPaneId, tabId: string) => {
      const pane = layout.panes.find((current) => current.id === paneId);
      const removedTab = pane?.tabs.find((tab) => tab.id === tabId) ?? null;
      const nextLayout = closePreviewPaneTab(layout, paneId, tabId);
      if (removedTab && confirmDiscardClosedDirtyTabs([removedTab], nextLayout)) {
        closeTerminalPreviewTabs([removedTab], terminalLifecycle);
        applyLayout(nextLayout);
      }
    },
    [applyLayout, confirmDiscardClosedDirtyTabs, layout, terminalLifecycle],
  );

  const closeOtherTabs = useCallback(
    (paneId: PreviewPaneId, keepTabId: string) => {
      const pane = layout.panes.find((current) => current.id === paneId);
      const removedTabs = pane?.tabs.filter((tab) => tab.id !== keepTabId) ?? [];
      const nextLayout = closeOtherPreviewPaneTabs(layout, paneId, keepTabId);
      if (confirmDiscardClosedDirtyTabs(removedTabs, nextLayout)) {
        closeTerminalPreviewTabs(removedTabs, terminalLifecycle);
        applyLayout(nextLayout);
      }
    },
    [applyLayout, confirmDiscardClosedDirtyTabs, layout, terminalLifecycle],
  );

  const closeAllTabs = useCallback(
    (paneId: PreviewPaneId) => {
      const pane = layout.panes.find((current) => current.id === paneId);
      const removedTabs = pane?.tabs ?? [];
      const nextLayout = closeAllPreviewPaneTabs(layout, paneId);
      if (confirmDiscardClosedDirtyTabs(removedTabs, nextLayout)) {
        closeTerminalPreviewTabs(removedTabs, terminalLifecycle);
        applyLayout(nextLayout);
      }
    },
    [applyLayout, confirmDiscardClosedDirtyTabs, layout, terminalLifecycle],
  );

  const closeActivePreviewTab = useCallback(() => {
    if (activePane?.activeTabId) {
      closePreviewTab(activePane.id, activePane.activeTabId);
    }
  }, [activePane, closePreviewTab]);

  return {
    closeActivePreviewTab,
    closeAllTabs,
    closeOtherTabs,
    closePreviewTab,
  };
}
