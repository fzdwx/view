import {
  FolderOpen,
  GitBranch,
  GitPullRequestArrow,
  Settings as SettingsIcon,
  TerminalSquare,
} from "lucide-react";
import type { SavedProject } from "../lib/projects";
import { openSettingsWindow } from "../lib/settingsWindow";
import type { ToolPanelId } from "../lib/workbenchTypes";
import { ProjectSwitcherPopover } from "./ProjectSwitcherPopover";

export interface ProjectRailProps {
  readonly activeProjectId: string | null;
  readonly activeProjectName: string | null;
  readonly activityView: ToolPanelId;
  readonly hasActiveProject: boolean;
  readonly projectSwitcherOpen: boolean;
  readonly projects: SavedProject[];
  readonly onChooseRepository: () => void;
  readonly onCloseProjectSwitcher: () => void;
  readonly onRemoveProject: (projectId: string) => void;
  readonly onSelectProject: (project: SavedProject) => void;
  readonly onSelectToolPanelView: (view: ToolPanelId) => void;
  readonly onToggleProjectSwitcher: () => void;
}

export function ProjectRail({
  activeProjectId,
  activeProjectName,
  activityView,
  hasActiveProject,
  projectSwitcherOpen,
  projects,
  onChooseRepository,
  onCloseProjectSwitcher,
  onRemoveProject,
  onSelectProject,
  onSelectToolPanelView,
  onToggleProjectSwitcher,
}: ProjectRailProps) {
  return (
    <aside className="project-rail" aria-label="Projects">
      <div className="brand-row">
        <div className="brand-mark">
          <GitPullRequestArrow size={18} />
        </div>
      </div>

      <div className="project-switcher-anchor">
        <button
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

      <div className="rail-spacer" />
      <button
        className={
          activityView === "git"
            ? "activity-button rail-project-button active"
            : "activity-button rail-project-button"
        }
        aria-label="Git"
        title="Git"
        disabled={!hasActiveProject}
        onClick={() => onSelectToolPanelView("git")}
      >
        <GitBranch size={18} />
      </button>
      <button
        className={
          activityView === "terminal"
            ? "activity-button rail-project-button active"
            : "activity-button rail-project-button"
        }
        aria-label="Terminal"
        title="Terminal"
        disabled={!hasActiveProject}
        onClick={() => onSelectToolPanelView("terminal")}
      >
        <TerminalSquare size={18} />
      </button>
      <button
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
