import { clamp } from "./numeric";
import { isGitPanelId } from "./workbenchGrid";
import {
  defaultGitPanelOrder,
  defaultRailActiveItems,
  defaultPanelSizes,
  defaultRailLayout,
  defaultWorkbenchLayout,
  type GitPanelId,
  type PanelSizes,
  type RailActiveItems,
  type RailItemId,
  type RailLayout,
  type ToolDock,
  type ToolPanelId,
  type TreeDock,
  type WorkbenchLayout,
} from "./workbenchTypes";

const layoutStorageKey = "view.workbench-layout.v2";
const legacyLayoutStorageKey = "view.workbench-layout.v1";

export function loadWorkbenchLayout(): WorkbenchLayout {
  if (typeof localStorage === "undefined") {
    return defaultWorkbenchLayout;
  }

  try {
    const raw =
      localStorage.getItem(layoutStorageKey) ??
      localStorage.getItem(legacyLayoutStorageKey);
    if (!raw) {
      return defaultWorkbenchLayout;
    }

    return normalizeWorkbenchLayout(JSON.parse(raw));
  } catch {
    return defaultWorkbenchLayout;
  }
}

export function saveWorkbenchLayout(layout: WorkbenchLayout): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(layoutStorageKey, JSON.stringify(layout));
}

function normalizeWorkbenchLayout(value: unknown): WorkbenchLayout {
  const record = isRecord(value) ? value : {};
  const projectInToolDock =
    typeof record.projectInToolDock === "boolean"
      ? record.projectInToolDock
      : defaultWorkbenchLayout.projectInToolDock;
  const detachedGitPanels = normalizeDetachedGitPanels(record.detachedGitPanels);
  const railLayout = normalizeRailLayout(record.railLayout);
  const activityView = normalizeActivityView(
    record.activityView,
    projectInToolDock,
    detachedGitPanels,
  );

  return {
    activityView,
    toolDock: isToolDock(record.toolDock)
      ? record.toolDock
      : defaultWorkbenchLayout.toolDock,
    treeDock: isTreeDock(record.treeDock)
      ? record.treeDock
      : defaultWorkbenchLayout.treeDock,
    treeVisible:
      typeof record.treeVisible === "boolean"
        ? record.treeVisible
        : defaultWorkbenchLayout.treeVisible,
    projectInToolDock,
    gitPanelOrder: normalizeGitPanelOrder(record.gitPanelOrder),
    detachedGitPanels,
    railLayout,
    railActiveItems: normalizeRailActiveItems(
      record.railActiveItems,
      railLayout,
    ),
    panelSizes: normalizePanelSizes(record.panelSizes),
  };
}

function normalizeActivityView(
  value: unknown,
  projectInToolDock: boolean,
  detachedGitPanels: GitPanelId[],
): ToolPanelId {
  if (!isToolPanelId(value)) {
    return defaultWorkbenchLayout.activityView;
  }
  if (value === "project" && !projectInToolDock) {
    return "git";
  }
  if (isGitPanelId(value) && !detachedGitPanels.includes(value)) {
    return "git";
  }

  return value;
}

function normalizeRailLayout(value: unknown): RailLayout {
  const record = isRecord(value) ? value : {};
  const left = normalizeRailSide(record.left);
  const right = normalizeRailSide(record.right);
  const seen = new Set<RailItemId>();
  for (const item of [...left.top, ...left.bottom, ...right.top, ...right.bottom]) {
    seen.add(item);
  }
  // Backfill any missing item into the left top slot to keep them reachable.
  for (const item of defaultRailLayout.left.top) {
    if (!seen.has(item)) {
      left.top = [...left.top, item];
      seen.add(item);
    }
  }
  for (const item of defaultRailLayout.left.bottom) {
    if (!seen.has(item)) {
      left.bottom = [...left.bottom, item];
      seen.add(item);
    }
  }
  return { left, right };
}

function normalizeRailActiveItems(
  value: unknown,
  railLayout: RailLayout,
): RailActiveItems {
  const record = isRecord(value) ? value : {};
  const fallback = defaultRailActiveItemsForLayout(railLayout);
  return {
    left: normalizeRailActiveSide(record.left, railLayout.left, fallback.left),
    right: normalizeRailActiveSide(record.right, railLayout.right, fallback.right),
  };
}

function normalizeRailActiveSide(
  value: unknown,
  railSide: { top: RailItemId[]; bottom: RailItemId[] },
  fallback: { top: RailItemId | null; bottom: RailItemId | null },
): { top: RailItemId | null; bottom: RailItemId | null } {
  const record = isRecord(value) ? value : {};
  return {
    top: normalizeRailActiveItem(record.top, railSide.top, fallback.top),
    bottom: normalizeRailActiveItem(record.bottom, railSide.bottom, fallback.bottom),
  };
}

function normalizeRailActiveItem(
  value: unknown,
  items: readonly RailItemId[],
  fallback: RailItemId | null,
): RailItemId | null {
  if (isRailItemId(value) && items.includes(value)) {
    return value;
  }
  // An explicit null means the slot was collapsed; preserve it instead of
  // auto-selecting the first item and reopening the panel on reload.
  if (value === null) {
    return null;
  }
  if (fallback && items.includes(fallback)) {
    return fallback;
  }
  return items[0] ?? null;
}

function defaultRailActiveItemsForLayout(railLayout: RailLayout): RailActiveItems {
  return {
    left: {
      top: railLayout.left.top[0] ?? defaultRailActiveItems.left.top,
      bottom: railLayout.left.bottom[0] ?? defaultRailActiveItems.left.bottom,
    },
    right: {
      top: railLayout.right.top[0] ?? defaultRailActiveItems.right.top,
      bottom: railLayout.right.bottom[0] ?? defaultRailActiveItems.right.bottom,
    },
  };
}

function normalizeRailSide(value: unknown): { top: RailItemId[]; bottom: RailItemId[] } {
  const record = isRecord(value) ? value : {};
  return {
    top: normalizeRailItems(record.top),
    bottom: normalizeRailItems(record.bottom),
  };
}

function normalizeRailItems(value: unknown): RailItemId[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<RailItemId>();
  const items: RailItemId[] = [];
  for (const item of value) {
    if (isRailItemId(item) && !seen.has(item)) {
      seen.add(item);
      items.push(item);
    }
  }
  return items;
}

function isRailItemId(value: unknown): value is RailItemId {
  return value === "fileTree" || value === "git" || value === "commit" || value === "terminal";
}

function normalizeGitPanelOrder(value: unknown): GitPanelId[] {
  if (!Array.isArray(value)) {
    return defaultGitPanelOrder;
  }

  const seen = new Set<GitPanelId>();
  const order = value.filter((item): item is GitPanelId => {
    if (!isGitPanelId(item) || seen.has(item)) {
      return false;
    }
    seen.add(item);
    return true;
  });

  return [
    ...order,
    ...defaultGitPanelOrder.filter((panel) => !seen.has(panel)),
  ];
}

function normalizeDetachedGitPanels(value: unknown): GitPanelId[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<GitPanelId>();
  return value.filter((item): item is GitPanelId => {
    if (!isGitPanelId(item) || seen.has(item)) {
      return false;
    }
    seen.add(item);
    return true;
  });
}

function normalizePanelSizes(value: unknown): PanelSizes {
  const record = isRecord(value) ? value : {};
  return {
    rail: normalizePanelSize(record.rail, defaultPanelSizes.rail, 220, 460),
    tree: normalizePanelSize(record.tree, defaultPanelSizes.tree, 220, 560),
    log: normalizePanelSize(record.log, defaultPanelSizes.log, 180, 560),
    branch: normalizePanelSize(record.branch, defaultPanelSizes.branch, 120, 460),
    details: normalizePanelSize(
      record.details,
      defaultPanelSizes.details,
      120,
      460,
    ),
    commitInfo: normalizePanelSize(
      record.commitInfo,
      defaultPanelSizes.commitInfo,
      110,
      360,
    ),
    sideDock: normalizePanelSize(
      record.sideDock,
      defaultPanelSizes.sideDock,
      320,
      620,
    ),
    leftTop: normalizePanelSize(
      record.leftTop,
      typeof record.tree === "number" ? record.tree : defaultPanelSizes.leftTop,
      220,
      560,
    ),
    rightTop: normalizePanelSize(
      record.rightTop,
      typeof record.sideDock === "number"
        ? record.sideDock
        : defaultPanelSizes.rightTop,
      220,
      560,
    ),
    bottom: normalizePanelSize(
      record.bottom,
      typeof record.log === "number" ? record.log : defaultPanelSizes.bottom,
      180,
      560,
    ),
    bottomLeft: normalizePanelSize(
      record.bottomLeft,
      defaultPanelSizes.bottomLeft,
      260,
      1400,
    ),
  };
}

function normalizePanelSize(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, min, max)
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isToolDock(value: unknown): value is ToolDock {
  return value === "left" || value === "bottom" || value === "right";
}

function isTreeDock(value: unknown): value is TreeDock {
  return value === "left" || value === "right";
}

function isToolPanelId(value: unknown): value is ToolPanelId {
  return (
    value === "project" ||
    value === "git" ||
    value === "terminal" ||
    isGitPanelId(typeof value === "string" ? value : null)
  );
}
