export type ToolDock = "left" | "bottom" | "right";
export type TreeDock = "left" | "right";
export type ProjectDock = TreeDock | "panel";
export type EditorDock = "left" | "right";
export type GitPanelId = "branches" | "history" | "details";
export type ToolPanelId = "project" | "git" | "terminal" | GitPanelId;

export interface PanelSizes {
  rail: number;
  tree: number;
  log: number;
  branch: number;
  details: number;
  commitInfo: number;
  sideDock: number;
}

export interface WorkbenchLayout {
  activityView: ToolPanelId;
  toolDock: ToolDock;
  treeDock: TreeDock;
  treeVisible: boolean;
  projectInToolDock: boolean;
  gitPanelOrder: GitPanelId[];
  detachedGitPanels: GitPanelId[];
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
};

export const defaultWorkbenchLayout: WorkbenchLayout = {
  activityView: "git",
  toolDock: "bottom",
  treeDock: "left",
  treeVisible: true,
  projectInToolDock: false,
  gitPanelOrder: defaultGitPanelOrder,
  detachedGitPanels: [],
  panelSizes: defaultPanelSizes,
};
