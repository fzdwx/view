import {
  FolderTree,
  GitBranch,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";
import type { RailItemId } from "./workbenchTypes";

export interface RailItemDefinition {
  readonly id: RailItemId;
  readonly label: string;
  readonly icon: LucideIcon;
}

export const railItemDefinitions: Record<RailItemId, RailItemDefinition> = {
  fileTree: { id: "fileTree", label: "File tree", icon: FolderTree },
  git: { id: "git", label: "Git", icon: GitBranch },
  terminal: { id: "terminal", label: "Terminal", icon: TerminalSquare },
};
