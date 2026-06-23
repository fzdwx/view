import type { PreviewMode, PreviewTab, PreviewTarget } from "./previewTabs";

export type PreviewPaneId = string;
export type PreviewSplitDirection = "right" | "down";

export type PreviewPaneLayoutNode = PreviewPaneLeaf | PreviewPaneSplit;

export interface PreviewPaneLeaf {
  readonly kind: "pane";
  readonly paneId: PreviewPaneId;
}

export interface PreviewPaneSplit {
  readonly kind: "split";
  readonly direction: PreviewSplitDirection;
  readonly children: readonly PreviewPaneLayoutNode[];
}

export interface PreviewPane {
  readonly id: PreviewPaneId;
  readonly mode: PreviewMode;
  readonly tabs: readonly PreviewTab[];
  readonly activeTabId: string | null;
  readonly target: PreviewTarget | null;
}

export interface PreviewPaneLayout {
  readonly splitDirection: PreviewSplitDirection | null;
  readonly panes: readonly PreviewPane[];
  readonly tree: PreviewPaneLayoutNode;
  readonly activePaneId: PreviewPaneId;
}

export const primaryPreviewPaneId = "preview-pane-1";

export function createPreviewPane(id: PreviewPaneId): PreviewPane {
  return {
    id,
    mode: "file",
    tabs: [],
    activeTabId: null,
    target: null,
  };
}

export function createPreviewPaneLayout(): PreviewPaneLayout {
  return {
    splitDirection: null,
    panes: [createPreviewPane(primaryPreviewPaneId)],
    tree: createPreviewPaneLeaf(primaryPreviewPaneId),
    activePaneId: primaryPreviewPaneId,
  };
}

export function clearPreviewPaneLayout(
  mode: PreviewMode = "file",
): PreviewPaneLayout {
  return {
    splitDirection: null,
    panes: [{ ...createPreviewPane(primaryPreviewPaneId), mode }],
    tree: createPreviewPaneLeaf(primaryPreviewPaneId),
    activePaneId: primaryPreviewPaneId,
  };
}

export function activePreviewPane(
  layout: PreviewPaneLayout,
): PreviewPane | null {
  return layout.panes.find((pane) => pane.id === layout.activePaneId) ?? null;
}

export function activePreviewPaneTab(pane: PreviewPane): PreviewTab | null {
  return pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? null;
}

export function createPreviewPaneLeaf(
  paneId: PreviewPaneId,
): PreviewPaneLayoutNode {
  return { kind: "pane", paneId };
}

export function rootPreviewSplitDirection(
  tree: PreviewPaneLayoutNode,
): PreviewSplitDirection | null {
  switch (tree.kind) {
    case "pane":
      return null;
    case "split":
      return tree.direction;
    default:
      return assertNeverPreviewPaneNode(tree);
  }
}

function assertNeverPreviewPaneNode(
  _node: never,
): never {
  throw new Error("Unhandled preview pane layout node");
}
