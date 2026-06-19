import { Plus, X } from "lucide-react";
import type { SavedProject } from "../lib/projects";

export function ProjectSwitcherPopover({
  activeProjectId,
  projects,
  onChooseRepository,
  onClose,
  onRemoveProject,
  onSelectProject,
}: {
  activeProjectId: string | null;
  projects: SavedProject[];
  onChooseRepository(): void;
  onClose(): void;
  onRemoveProject(projectId: string): void;
  onSelectProject(project: SavedProject): void;
}) {
  return (
    // Anchor-positioned popover, not a centered modal: a native <dialog> opened with
    // showModal() would add a backdrop and centering that breaks popover placement.
    // oxlint-disable-next-line react-doctor/prefer-html-dialog, react-doctor/prefer-tag-over-role
    <div className="project-switcher-popover" role="dialog" aria-label="Switch project">
      <div className="project-switcher-head">
        <div>
          <div className="project-switcher-title">Projects</div>
          <div className="project-switcher-count">{projects.length} saved</div>
        </div>
        <button type="button" className="icon-button" aria-label="Close projects" onClick={onClose}>
         <X size={14} />
        </button>
      </div>
      <button type="button" className="primary-action rail-action" onClick={onChooseRepository}>
       <Plus size={16} />
        Open folder
      </button>
      <div className="project-list project-switcher-list">
        {projects.length === 0 ? (
          <div className="rail-empty">
            Add a folder to browse files. Git folders also unlock logs, branches, and diffs.
          </div>
        ) : null}
        {projects.map((project) => (
          <ProjectItem
            key={project.id}
            project={project}
            active={project.id === activeProjectId}
            onSelect={() => onSelectProject(project)}
            onRemove={() => onRemoveProject(project.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ProjectItem({
  project,
  active,
  onSelect,
  onRemove,
}: {
  project: SavedProject;
  active: boolean;
  onSelect(): void;
  onRemove(): void;
}) {
  return (
    <div className={active ? "project-item active" : "project-item"}>
      <button type="button" className="project-button" onClick={onSelect}>
       <span className="project-name">{project.name}</span>
        <span className="project-path">{project.activePath}</span>
      </button>
      <button type="button" className="project-remove" onClick={onRemove} aria-label="Remove">
       <X size={14} />
      </button>
    </div>
  );
}
