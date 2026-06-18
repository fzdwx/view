import { FolderTree } from "lucide-react";
import type { TreeDock } from "../lib/workbenchTypes";

export interface ProjectSideRailProps {
  readonly treeDock: TreeDock;
  readonly hasActiveProject: boolean;
  readonly treeVisible: boolean;
  readonly onToggleTreeVisible: () => void;
}

export function ProjectSideRail({
  treeDock,
  hasActiveProject,
  treeVisible,
  onToggleTreeVisible,
}: ProjectSideRailProps) {
  return (
    <aside className="project-rail project-side-rail" aria-label="File tree">
      {treeDock === "right" ? (
        <button
          className={
            treeVisible
              ? "activity-button rail-project-button active"
              : "activity-button rail-project-button"
          }
          aria-pressed={treeVisible}
          aria-label={treeVisible ? "Hide file tree" : "Show file tree"}
          title={treeVisible ? "Hide file tree" : "Show file tree"}
          disabled={!hasActiveProject}
          onClick={onToggleTreeVisible}
        >
          <FolderTree size={18} />
        </button>
      ) : null}
    </aside>
  );
}
