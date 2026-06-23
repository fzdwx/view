import type { PreviewTab, PreviewTarget } from "./previewTabs";
import {
  createPreviewPane,
  rootPreviewSplitDirection,
  type PreviewPane,
  type PreviewPaneId,
  type PreviewPaneLayout,
  type PreviewSplitDirection,
} from "./previewPaneTypes";
import { updatePreviewPane } from "./previewPaneState";
import { insertPreviewPaneTreeSplit } from "./previewPaneTree";

export function openPreviewPaneTab(
  layout: PreviewPaneLayout,
  paneId: PreviewPaneId,
  tab: PreviewTab,
  target: PreviewTarget | null,
): PreviewPaneLayout {
  return updatePreviewPane(
    layout,
    paneId,
    (pane) => ({
      ...pane,
      activeTabId: tab.id,
      mode: tab.mode,
      tabs: pane.tabs.some((current) => current.id === tab.id)
        ? pane.tabs
        : [...pane.tabs, tab],
      target,
    }),
    paneId,
  );
}

export function activatePreviewPaneTab(
  layout: PreviewPaneLayout,
  paneId: PreviewPaneId,
  tabId: string,
): PreviewPaneLayout {
  return updatePreviewPane(
    layout,
    paneId,
    (pane) => {
      const tab = pane.tabs.find((current) => current.id === tabId);
      return tab
        ? { ...pane, activeTabId: tab.id, mode: tab.mode, target: null }
        : pane;
    },
    paneId,
  );
}

export function activatePreviewPane(
  layout: PreviewPaneLayout,
  paneId: PreviewPaneId,
): PreviewPaneLayout {
  return layout.panes.some((pane) => pane.id === paneId)
    ? { ...layout, activePaneId: paneId }
    : layout;
}

export function showPreviewPaneDiffSelection(
  layout: PreviewPaneLayout,
  paneId: PreviewPaneId,
): PreviewPaneLayout {
  return updatePreviewPane(
    layout,
    paneId,
    (pane) => ({ ...pane, activeTabId: null, mode: "diff", target: null }),
    paneId,
  );
}

export function splitPreviewPaneTab(
  layout: PreviewPaneLayout,
  paneId: PreviewPaneId,
  tabId: string,
  direction: PreviewSplitDirection,
  nextPaneId: PreviewPaneId,
): PreviewPaneLayout {
  const sourcePane = layout.panes.find((pane) => pane.id === paneId);
  const sourceTab = sourcePane?.tabs.find((tab) => tab.id === tabId) ?? null;
  if (!sourcePane || !sourceTab) {
    return layout;
  }

  const sourceIndex = layout.panes.findIndex((pane) => pane.id === paneId);
  const nextDestination = destinationWithTab(
    createPreviewPane(nextPaneId),
    sourceTab,
  );
  const panes = [
    ...layout.panes.slice(0, sourceIndex + 1),
    nextDestination,
    ...layout.panes.slice(sourceIndex + 1),
  ];
  const treeResult = insertPreviewPaneTreeSplit(
    layout.tree,
    paneId,
    nextDestination.id,
    direction,
  );

  return treeResult.inserted
    ? {
        splitDirection: rootPreviewSplitDirection(treeResult.tree),
        panes,
        tree: treeResult.tree,
        activePaneId: nextDestination.id,
      }
    : layout;
}

export function reorderPreviewPaneTabs(
  layout: PreviewPaneLayout,
  paneId: PreviewPaneId,
  fromId: string,
  toId: string,
): PreviewPaneLayout {
  if (fromId === toId) {
    return layout;
  }

  return updatePreviewPane(layout, paneId, (pane) => {
    const fromIndex = pane.tabs.findIndex((tab) => tab.id === fromId);
    const toIndex = pane.tabs.findIndex((tab) => tab.id === toId);
    const moved = pane.tabs[fromIndex];
    if (fromIndex < 0 || toIndex < 0 || !moved) {
      return pane;
    }

    const tabs = pane.tabs.filter((tab) => tab.id !== fromId);
    return {
      ...pane,
      tabs: [...tabs.slice(0, toIndex), moved, ...tabs.slice(toIndex)],
    };
  });
}

export function movePreviewPaneTabPath(
  layout: PreviewPaneLayout,
  fromPath: string,
  toTab: PreviewTab,
): PreviewPaneLayout {
  return {
    ...layout,
    panes: layout.panes.map((pane) => ({
      ...pane,
      activeTabId:
        pane.tabs.find((tab) => tab.id === pane.activeTabId)?.path === fromPath
          ? toTab.id
          : pane.activeTabId,
      tabs: pane.tabs.map((tab) =>
        tab.mode === "file" && tab.path === fromPath ? toTab : tab,
      ),
    })),
  };
}

export function previewPaneTabs(layout: PreviewPaneLayout): readonly PreviewTab[] {
  return layout.panes.flatMap((pane) => pane.tabs);
}

function destinationWithTab(
  destination: PreviewPane,
  sourceTab: PreviewTab,
): PreviewPane {
  return {
    ...destination,
    activeTabId: sourceTab.id,
    mode: sourceTab.mode,
    tabs: destination.tabs.some((tab) => tab.id === sourceTab.id)
      ? destination.tabs
      : [...destination.tabs, sourceTab],
    target: null,
  };
}
