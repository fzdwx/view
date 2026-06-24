import type { CSSProperties } from "react";
import type { GitPanelId, RailLayout, RailSide, ToolDock } from "./workbenchTypes";


export function buildGitPanelGridStyle(
  dock: ToolDock,
  order: GitPanelId[],
  firstSize: number,
  lastSize: number,
): CSSProperties {
  const firstSizeVar = `var(--git-panel-first-size, ${firstSize}px)`;
  const lastSizeVar = `var(--git-panel-last-size, ${lastSize}px)`;

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
        gridTemplateRows: `${firstSizeVar} 6px minmax(0, 1fr)`,
        gridTemplateAreas: `"${first}" "git-splitter-1" "${second}"`,
      };
    }

    return {
      gridTemplateColumns: `${firstSizeVar} 6px minmax(0, 1fr)`,
      gridTemplateAreas: `"${first} git-splitter-1 ${second}"`,
    };
  }

  const [first, second, third] = order;
  if (dock !== "bottom") {
    return {
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateRows: `${firstSizeVar} 6px minmax(0, 1fr) 6px ${lastSizeVar}`,
      gridTemplateAreas: `"${first}" "git-splitter-1" "${second}" "git-splitter-2" "${third}"`,
    };
  }

  return {
    gridTemplateColumns: `${firstSizeVar} 6px minmax(0, 1fr) 6px ${lastSizeVar}`,
    gridTemplateAreas: `"${first} git-splitter-1 ${second} git-splitter-2 ${third}"`,
  };
}

export function buildRailWorkbenchGridStyle(
  hasLeftTopPanel: boolean,
  hasRightTopPanel: boolean,
  hasBottomPanels: boolean,
): CSSProperties {
  const columns: string[] = [];
  const topAreas: string[] = [];
  const leftTopWidth = "var(--rail-left-top-width, 280px)";
  const rightTopWidth = "var(--rail-right-top-width, 320px)";
  const bottomHeight = "var(--rail-bottom-height, 260px)";

  if (hasLeftTopPanel) {
    columns.push(leftTopWidth, "6px");
    topAreas.push("left-top", "left-top-splitter");
  }

  columns.push("minmax(0, 1fr)");
  topAreas.push("center");

  if (hasRightTopPanel) {
    columns.push("6px", rightTopWidth);
    topAreas.push("right-top-splitter", "right-top");
  }

  const templateAreas = [`"${topAreas.join(" ")}"`];
  if (hasBottomPanels) {
    templateAreas.push(
      `"${topAreas.map(() => "bottom-splitter").join(" ")}"`,
      `"${topAreas.map(() => "bottom").join(" ")}"`,
    );
  }

  return {
    gridTemplateColumns: columns.join(" "),
    gridTemplateRows: hasBottomPanels
      ? `minmax(0, 1fr) 6px ${bottomHeight}`
      : "minmax(0, 1fr)",
    gridTemplateAreas: templateAreas.join(" "),
  };
}

export function buildRailBottomPanelsStyle(
  hasLeftBottomPanel: boolean,
  hasRightBottomPanel: boolean,
): CSSProperties {
  const bottomLeftWidth = "var(--rail-bottom-left-width, 320px)";

  if (hasLeftBottomPanel && hasRightBottomPanel) {
    return {
      gridTemplateColumns: `${bottomLeftWidth} 10px minmax(0, 1fr)`,
      gridTemplateAreas: '"left-bottom bottom-inner-splitter right-bottom"',
    };
  }

  if (hasLeftBottomPanel) {
    return {
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateAreas: '"left-bottom"',
    };
  }

  return {
    gridTemplateColumns: "minmax(0, 1fr)",
    gridTemplateAreas: '"right-bottom"',
  };
}

export function railSideHasIcons(railLayout: RailLayout, side: RailSide): boolean {
  const sideLayout = railLayout[side];
  return sideLayout.top.length > 0 || sideLayout.bottom.length > 0;
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
