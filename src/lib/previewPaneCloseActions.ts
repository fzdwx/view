import type { PreviewTab } from "./previewTabs";
import {
  type PreviewPaneId,
  type PreviewPaneLayout,
} from "./previewPaneTypes";
import {
  compactPreviewPanes,
  updatePreviewPane,
} from "./previewPaneState";

export function closePreviewPaneTab(
  layout: PreviewPaneLayout,
  paneId: PreviewPaneId,
  tabId: string,
): PreviewPaneLayout {
  const nextLayout = updatePreviewPane(layout, paneId, (pane) => {
    const closedIndex = pane.tabs.findIndex((tab) => tab.id === tabId);
    if (closedIndex < 0) {
      return pane;
    }

    const tabs = pane.tabs.filter((tab) => tab.id !== tabId);
    if (pane.activeTabId !== tabId) {
      return { ...pane, tabs };
    }

    const nextTab = nextActiveTab(tabs, closedIndex);
    return {
      ...pane,
      activeTabId: nextTab?.id ?? null,
      mode: nextTab?.mode ?? "file",
      tabs,
      target: null,
    };
  });

  return compactPreviewPanes(nextLayout);
}

export function closeOtherPreviewPaneTabs(
  layout: PreviewPaneLayout,
  paneId: PreviewPaneId,
  keepTabId: string,
): PreviewPaneLayout {
  return updatePreviewPane(
    layout,
    paneId,
    (pane) => {
      const keepTab = pane.tabs.find((tab) => tab.id === keepTabId);
      return keepTab
        ? {
            ...pane,
            activeTabId: keepTab.id,
            mode: keepTab.mode,
            tabs: [keepTab],
            target: null,
          }
        : pane;
    },
    paneId,
  );
}

export function closeAllPreviewPaneTabs(
  layout: PreviewPaneLayout,
  paneId: PreviewPaneId,
): PreviewPaneLayout {
  const nextLayout = updatePreviewPane(layout, paneId, (pane) => ({
    ...pane,
    activeTabId: null,
    mode: "file",
    tabs: [],
    target: null,
  }));

  return compactPreviewPanes(nextLayout);
}

export function removePreviewPaneTabsForPath(
  layout: PreviewPaneLayout,
  path: string,
): PreviewPaneLayout {
  const nextLayout = {
    ...layout,
    panes: layout.panes.map((pane) => {
      const removedIndex = pane.tabs.findIndex(
        (tab) => tab.mode === "file" && tab.path === path,
      );
      if (removedIndex < 0) {
        return pane;
      }

      const tabs = pane.tabs.filter(
        (tab) => !(tab.mode === "file" && tab.path === path),
      );
      if (!pane.activeTabId || tabs.some((tab) => tab.id === pane.activeTabId)) {
        return { ...pane, tabs };
      }

      const nextTab = nextActiveTab(tabs, removedIndex);
      return {
        ...pane,
        activeTabId: nextTab?.id ?? null,
        mode: nextTab?.mode ?? "file",
        tabs,
        target: null,
      };
    }),
  };

  return compactPreviewPanes(nextLayout);
}

function nextActiveTab(
  tabs: readonly PreviewTab[],
  closedIndex: number,
): PreviewTab | null {
  return tabs[Math.max(0, closedIndex - 1)] ?? tabs[0] ?? null;
}
