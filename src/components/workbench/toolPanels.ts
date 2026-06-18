import {
  Folder,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequestArrow,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";
import type { GitPanelId, ToolPanelId } from "../../lib/workbenchTypes";

export type ToolDockPanelDefinition = {
  readonly id: ToolPanelId;
  readonly label: string;
  readonly icon: LucideIcon;
};

export type GitDockPanelDefinition = {
  readonly id: GitPanelId;
  readonly label: string;
  readonly icon: LucideIcon;
};

export const toolPanels: ToolDockPanelDefinition[] = [
  { id: "project", label: "Project", icon: Folder },
  { id: "git", label: "Git", icon: GitBranch },
  { id: "terminal", label: "Terminal", icon: TerminalSquare },
];

export const gitToolPanels: GitDockPanelDefinition[] = [
  { id: "branches", label: "Branches", icon: GitBranch },
  { id: "history", label: "History", icon: GitCommitHorizontal },
  { id: "details", label: "Details", icon: GitPullRequestArrow },
];
