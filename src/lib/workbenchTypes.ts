export type ToolDock = "left" | "bottom" | "right";
export type TreeDock = "left" | "right";
export type ProjectDock = TreeDock | "panel";
export type EditorDock = "left" | "right";
export type GitPanelId = "branches" | "history" | "details";

export type RailItemId = "fileTree" | "git" | "terminal";

export type RailSide = "left" | "right";

export type RailSlot = "top" | "bottom";

export interface RailPlacement {
  readonly side: RailSide;
  readonly slot: RailSlot;
}

export type RailLayout = Record<RailSide, { top: RailItemId[]; bottom: RailItemId[] }>;

export type RailActiveItems = Record<
  RailSide,
  { top: RailItemId | null; bottom: RailItemId | null }
>;

export type ToolPanelId = "project" | "git" | "terminal" | GitPanelId;

export interface PanelSizes {
  rail: number;
  tree: number;
  log: number;
  branch: number;
  details: number;
  commitInfo: number;
  sideDock: number;
  leftTop: number;
  rightTop: number;
  bottom: number;
  bottomLeft: number;
}

export interface WorkbenchLayout {
  activityView: ToolPanelId;
  toolDock: ToolDock;
  treeDock: TreeDock;
  treeVisible: boolean;
  projectInToolDock: boolean;
  gitPanelOrder: GitPanelId[];
  detachedGitPanels: GitPanelId[];
  railLayout: RailLayout;
  railActiveItems: RailActiveItems;
  panelSizes: PanelSizes;
}

export const defaultGitPanelOrder: GitPanelId[] = [
  "branches",
  "history",
  "details",
];

export const defaultPanelSizes: PanelSizes = {
  rail: 292,
  tree: 300,
  log: 280,
  branch: 260,
  details: 280,
  commitInfo: 154,
  sideDock: 420,
  leftTop: 300,
  rightTop: 300,
  bottom: 280,
  bottomLeft: 480,
};

export const defaultRailLayout: RailLayout = {
  left: { top: ["fileTree"], bottom: ["git", "terminal"] },
  right: { top: [], bottom: [] },
};

export const defaultRailActiveItems: RailActiveItems = {
  left: { top: "fileTree", bottom: "git" },
  right: { top: null, bottom: null },
};

export const defaultWorkbenchLayout: WorkbenchLayout = {
  activityView: "git",
  toolDock: "bottom",
  treeDock: "left",
  treeVisible: true,
  projectInToolDock: false,
  gitPanelOrder: defaultGitPanelOrder,
  detachedGitPanels: [],
  railLayout: defaultRailLayout,
  railActiveItems: defaultRailActiveItems,
  panelSizes: defaultPanelSizes,
};
