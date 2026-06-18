import type { CSSProperties } from "react";
import type { GitPanelId, ToolDock, TreeDock } from "./workbenchTypes";

export function buildContentGridStyle(
  treeDock: TreeDock,
  toolDock: ToolDock,
  hasProjectSidePanel: boolean,
  treeWidth: number,
  logHeight: number,
  sideDockWidth: number,
): CSSProperties {
  if (!hasProjectSidePanel) {
    if (toolDock === "left") {
      return {
        gridTemplateColumns: `${sideDockWidth}px 6px minmax(0, 1fr)`,
        gridTemplateRows: "minmax(0, 1fr)",
        gridTemplateAreas: '"dock dock-splitter diff"',
      };
    }

    if (toolDock === "right") {
      return {
        gridTemplateColumns: `minmax(0, 1fr) 6px ${sideDockWidth}px`,
        gridTemplateRows: "minmax(0, 1fr)",
        gridTemplateAreas: '"diff dock-splitter dock"',
      };
    }

    return {
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateRows: `minmax(0, 1fr) 6px ${logHeight}px`,
      gridTemplateAreas: '"diff" "log-splitter" "log"',
    };
  }

  if (toolDock === "left") {
    return treeDock === "left"
      ? {
          gridTemplateColumns: `${sideDockWidth}px 6px ${treeWidth}px 6px minmax(0, 1fr)`,
          gridTemplateRows: "minmax(0, 1fr)",
          gridTemplateAreas:
            '"dock dock-splitter tree tree-splitter diff"',
        }
      : {
          gridTemplateColumns: `${sideDockWidth}px 6px minmax(0, 1fr) 6px ${treeWidth}px`,
          gridTemplateRows: "minmax(0, 1fr)",
          gridTemplateAreas:
            '"dock dock-splitter diff tree-splitter tree"',
        };
  }

  if (toolDock === "right") {
    return treeDock === "left"
      ? {
          gridTemplateColumns: `${treeWidth}px 6px minmax(0, 1fr) 6px ${sideDockWidth}px`,
          gridTemplateRows: "minmax(0, 1fr)",
          gridTemplateAreas:
            '"tree tree-splitter diff dock-splitter dock"',
        }
      : {
          gridTemplateColumns: `minmax(0, 1fr) 6px ${treeWidth}px 6px ${sideDockWidth}px`,
          gridTemplateRows: "minmax(0, 1fr)",
          gridTemplateAreas:
            '"diff tree-splitter tree dock-splitter dock"',
        };
  }

  return treeDock === "left"
    ? {
        gridTemplateColumns: `${treeWidth}px 6px minmax(0, 1fr)`,
        gridTemplateRows: `minmax(0, 1fr) 6px ${logHeight}px`,
        gridTemplateAreas:
          '"tree tree-splitter diff" "log-splitter log-splitter log-splitter" "log log log"',
      }
    : {
        gridTemplateColumns: `minmax(0, 1fr) 6px ${treeWidth}px`,
        gridTemplateRows: `minmax(0, 1fr) 6px ${logHeight}px`,
        gridTemplateAreas:
          '"diff tree-splitter tree" "log-splitter log-splitter log-splitter" "log log log"',
      };
}

export function buildGitPanelGridStyle(
  dock: ToolDock,
  order: GitPanelId[],
  firstSize: number,
  lastSize: number,
): CSSProperties {
  if (order.length === 0) {
    return {
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateRows: "minmax(0, 1fr)",
      gridTemplateAreas: '"empty"',
    };
  }

  if (order.length === 1) {
    return {
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateRows: "minmax(0, 1fr)",
      gridTemplateAreas: `"${order[0]}"`,
    };
  }

  if (order.length === 2) {
    const [first, second] = order;
    if (dock !== "bottom") {
      return {
        gridTemplateColumns: "minmax(0, 1fr)",
        gridTemplateRows: `${firstSize}px 6px minmax(0, 1fr)`,
        gridTemplateAreas: `"${first}" "git-splitter-1" "${second}"`,
      };
    }

    return {
      gridTemplateColumns: `${firstSize}px 6px minmax(0, 1fr)`,
      gridTemplateAreas: `"${first} git-splitter-1 ${second}"`,
    };
  }

  const [first, second, third] = order;
  if (dock !== "bottom") {
    return {
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateRows: `${firstSize}px 6px minmax(0, 1fr) 6px ${lastSize}px`,
      gridTemplateAreas: `"${first}" "git-splitter-1" "${second}" "git-splitter-2" "${third}"`,
    };
  }

  return {
    gridTemplateColumns: `${firstSize}px 6px minmax(0, 1fr) 6px ${lastSize}px`,
    gridTemplateAreas: `"${first} git-splitter-1 ${second} git-splitter-2 ${third}"`,
  };
}

export function gitPanelLabel(panelId: GitPanelId): string {
  switch (panelId) {
    case "branches":
      return "Branches";
    case "history":
      return "History";
    case "details":
      return "Details";
  }
}

export function isGitPanelId(
  panelId: string | null | undefined,
): panelId is GitPanelId {
  return panelId === "branches" || panelId === "history" || panelId === "details";
}
