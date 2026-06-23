import {
  clearPreviewPaneLayout,
  rootPreviewSplitDirection,
  type PreviewPane,
  type PreviewPaneId,
  type PreviewPaneLayout,
} from "./previewPaneTypes";
import { prunePreviewPaneTree } from "./previewPaneTree";

export function updatePreviewPane(
  layout: PreviewPaneLayout,
  paneId: PreviewPaneId,
  update: (pane: PreviewPane) => PreviewPane,
  activePaneId = layout.activePaneId,
): PreviewPaneLayout {
  if (!layout.panes.some((pane) => pane.id === paneId)) {
    return layout;
  }

  return {
    ...layout,
    activePaneId,
    panes: layout.panes.map((pane) => (pane.id === paneId ? update(pane) : pane)),
  };
}

export function compactPreviewPanes(
  layout: PreviewPaneLayout,
): PreviewPaneLayout {
  if (layout.panes.length <= 1) {
    const pane = layout.panes[0];
    return pane
      ? { ...layout, splitDirection: null, tree: { kind: "pane", paneId: pane.id } }
      : clearPreviewPaneLayout("file");
  }

  const panes = layout.panes.filter((pane) => pane.tabs.length > 0);
  if (panes.length === 0) {
    return clearPreviewPaneLayout("file");
  }

  const activePaneId = panes.some((pane) => pane.id === layout.activePaneId)
    ? layout.activePaneId
    : panes[0].id;
  const tree =
    prunePreviewPaneTree(
      layout.tree,
      new Set(panes.map((pane) => pane.id)),
    ) ?? { kind: "pane", paneId: activePaneId };

  return {
    splitDirection: rootPreviewSplitDirection(tree),
    panes,
    tree,
    activePaneId,
  };
}
