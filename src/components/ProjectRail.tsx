import { FolderOpen, Settings as SettingsIcon } from "lucide-react";
import type { SavedProject } from "../lib/projects";
import { openSettingsWindow } from "../lib/settingsWindow";
import type {
  RailItemId,
  RailLayout,
} from "../lib/workbenchTypes";
import { ProjectSwitcherPopover } from "./ProjectSwitcherPopover";
import { RailSlotList } from "./RailSlots";

export interface ProjectRailProps {
  readonly activeProjectId: string | null;
  readonly activeProjectName: string | null;
  readonly draggedRailItem: RailItemId | null;
  readonly hasActiveProject: boolean;
  readonly isActiveItem: (item: RailItemId) => boolean;
  readonly projectSwitcherOpen: boolean;
  readonly projects: SavedProject[];
  readonly railLayout: RailLayout;
  readonly onChooseRepository: () => void;
  readonly onCloseProjectSwitcher: () => void;
  readonly onRemoveProject: (projectId: string) => void;
  readonly onSelectProject: (project: SavedProject) => void;
  readonly onDropRailItem: (item: RailItemId, slot: "top" | "bottom") => void;
  readonly onSelectRailItem: (item: RailItemId, slot: "top" | "bottom") => void;
  readonly onStartRailItemDrag: (item: RailItemId) => void;
  readonly onToggleProjectSwitcher: () => void;
}

export function ProjectRail({
  activeProjectId,
  activeProjectName,
  draggedRailItem,
  hasActiveProject,
  isActiveItem,
  projectSwitcherOpen,
  projects,
  railLayout,
  onChooseRepository,
  onCloseProjectSwitcher,
  onRemoveProject,
  onSelectProject,
  onDropRailItem,
  onSelectRailItem,
  onStartRailItemDrag,
  onToggleProjectSwitcher,
}: ProjectRailProps) {
  return (
    <aside className="project-rail" aria-label="Projects">
      <div className="project-switcher-anchor">
        <button
          type="button"
          className={
            projectSwitcherOpen
              ? "activity-button rail-project-button active"
              : "activity-button rail-project-button"
          }
          aria-expanded={projectSwitcherOpen}
          aria-haspopup="dialog"
          aria-label="Switch project"
          title={activeProjectName ?? "Switch project"}
          onClick={onToggleProjectSwitcher}
        >
          <FolderOpen size={18} />
        </button>
        {projectSwitcherOpen ? (
          <ProjectSwitcherPopover
            projects={projects}
            activeProjectId={activeProjectId}
            onChooseRepository={onChooseRepository}
            onClose={onCloseProjectSwitcher}
            onRemoveProject={onRemoveProject}
            onSelectProject={onSelectProject}
          />
        ) : null}
      </div>

      <RailSlotList
        draggedRailItem={draggedRailItem}
        isActiveItem={isActiveItem}
        items={railLayout.left.top}
        slot="top"
        disabled={!hasActiveProject}
        onSelectRailItem={onSelectRailItem}
        onStartRailItemDrag={onStartRailItemDrag}
        onDropRailItem={onDropRailItem}
      />
      <div className="rail-spacer" />
      <RailSlotList
        draggedRailItem={draggedRailItem}
        isActiveItem={isActiveItem}
        items={railLayout.left.bottom}
        slot="bottom"
        disabled={!hasActiveProject}
        onSelectRailItem={onSelectRailItem}
        onStartRailItemDrag={onStartRailItemDrag}
        onDropRailItem={onDropRailItem}
      />
      <button
        type="button"
        className="activity-button rail-project-button"
        aria-label="Settings"
        title="Settings"
        onClick={() => {
          onCloseProjectSwitcher();
          void openSettingsWindow();
        }}
      >
        <SettingsIcon size={18} />
      </button>
    </aside>
  );
}
