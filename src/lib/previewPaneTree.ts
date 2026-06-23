import {
  createPreviewPaneLeaf,
  type PreviewPaneId,
  type PreviewPaneLayoutNode,
  type PreviewSplitDirection,
} from "./previewPaneTypes";

interface InsertPreviewPaneResult {
  readonly inserted: boolean;
  readonly tree: PreviewPaneLayoutNode;
}

export function insertPreviewPaneTreeSplit(
  tree: PreviewPaneLayoutNode,
  sourcePaneId: PreviewPaneId,
  destinationPaneId: PreviewPaneId,
  direction: PreviewSplitDirection,
): InsertPreviewPaneResult {
  switch (tree.kind) {
    case "pane":
      return tree.paneId === sourcePaneId
        ? {
            inserted: true,
            tree: {
              kind: "split",
              direction,
              children: [
                createPreviewPaneLeaf(sourcePaneId),
                createPreviewPaneLeaf(destinationPaneId),
              ],
            },
          }
        : { inserted: false, tree };
    case "split":
      return insertIntoSplitNode(
        tree,
        sourcePaneId,
        destinationPaneId,
        direction,
      );
    default:
      return assertNeverPreviewPaneTree(tree);
  }
}

export function prunePreviewPaneTree(
  tree: PreviewPaneLayoutNode,
  paneIds: ReadonlySet<PreviewPaneId>,
): PreviewPaneLayoutNode | null {
  switch (tree.kind) {
    case "pane":
      return paneIds.has(tree.paneId) ? tree : null;
    case "split": {
      const children = tree.children
        .map((child) => prunePreviewPaneTree(child, paneIds))
        .filter(isPreviewPaneLayoutNode);
      const onlyChild = children[0] ?? null;
      if (children.length <= 1) {
        return onlyChild;
      }
      return { ...tree, children };
    }
    default:
      return assertNeverPreviewPaneTree(tree);
  }
}

function insertIntoSplitNode(
  tree: Extract<PreviewPaneLayoutNode, { readonly kind: "split" }>,
  sourcePaneId: PreviewPaneId,
  destinationPaneId: PreviewPaneId,
  direction: PreviewSplitDirection,
): InsertPreviewPaneResult {
  let inserted = false;
  const children: PreviewPaneLayoutNode[] = [];

  for (const child of tree.children) {
    if (!inserted && isDirectSameDirectionSplit(child, tree.direction, direction)) {
      children.push(child, createPreviewPaneLeaf(destinationPaneId));
      inserted = true;
      continue;
    }

    if (!inserted) {
      const result = insertPreviewPaneTreeSplit(
        child,
        sourcePaneId,
        destinationPaneId,
        direction,
      );
      children.push(result.tree);
      inserted = result.inserted;
      continue;
    }

    children.push(child);
  }

  return { inserted, tree: inserted ? { ...tree, children } : tree };

  function isDirectSameDirectionSplit(
    child: PreviewPaneLayoutNode,
    parentDirection: PreviewSplitDirection,
    splitDirection: PreviewSplitDirection,
  ): boolean {
    return (
      child.kind === "pane" &&
      child.paneId === sourcePaneId &&
      parentDirection === splitDirection
    );
  }
}

function isPreviewPaneLayoutNode(
  node: PreviewPaneLayoutNode | null,
): node is PreviewPaneLayoutNode {
  return node !== null;
}

function assertNeverPreviewPaneTree(_tree: never): never {
  throw new Error("Unhandled preview pane layout node");
}
