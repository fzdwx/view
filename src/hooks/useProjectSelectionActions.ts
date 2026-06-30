import { useCallback, type Dispatch, type SetStateAction } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "../lib/api";
import type { PreviewMode } from "../lib/previewTabs";
import {
  activateProjectPath,
  type SavedProject,
  upsertProject,
} from "../lib/projects";

export interface UseProjectSelectionActionsOptions {
  readonly activeProject: SavedProject | undefined;
  readonly activeProjectId: string | null;
  readonly clearPreviewTabs: (mode?: PreviewMode) => void;
  readonly confirmDiscardProjectDrafts: (
    projectPath: string,
    action: string,
  ) => boolean;
  readonly discardDraftsForProject: (projectPath: string) => void;
  readonly projects: SavedProject[];
  readonly setActiveBranchRef: Dispatch<SetStateAction<string | null>>;
  readonly setActiveCommit: Dispatch<SetStateAction<string | null>>;
  readonly setActiveProjectId: Dispatch<SetStateAction<string | null>>;
  readonly setProjectSwitcherOpen: Dispatch<SetStateAction<boolean>>;
  readonly setProjects: Dispatch<SetStateAction<SavedProject[]>>;
  readonly setSelectedChangePath: Dispatch<SetStateAction<string | null>>;
  readonly setSelectedProjectPath: Dispatch<SetStateAction<string | null>>;
}

export interface ProjectSelectionActions {
  readonly chooseRepository: () => Promise<void>;
  readonly removeProject: (projectId: string) => void;
  readonly selectProject: (project: SavedProject) => void;
  readonly selectProjectPath: (
    rootPath: string,
    activePath: string,
    action: string,
  ) => boolean;
}

export function useProjectSelectionActions({
  activeProject,
  activeProjectId,
  clearPreviewTabs,
  confirmDiscardProjectDrafts,
  discardDraftsForProject,
  projects,
  setActiveBranchRef,
  setActiveCommit,
  setActiveProjectId,
  setProjectSwitcherOpen,
  setProjects,
  setSelectedChangePath,
  setSelectedProjectPath,
}: UseProjectSelectionActionsOptions): ProjectSelectionActions {
  const resetProjectSelection = useCallback(() => {
    setActiveCommit(null);
    setActiveBranchRef(null);
    setSelectedProjectPath(null);
    setSelectedChangePath(null);
    clearPreviewTabs("file");
  }, [
    clearPreviewTabs,
    setActiveBranchRef,
    setActiveCommit,
    setSelectedChangePath,
    setSelectedProjectPath,
  ]);

  const chooseRepository = useCallback(async () => {
    if (!isTauriRuntime()) {
      return;
    }

    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open project folder",
    });

    if (typeof selected !== "string") {
      return;
    }

    if (
      activeProject &&
      activeProject.activePath !== selected &&
      !confirmDiscardProjectDrafts(activeProject.activePath, "open another repository")
    ) {
      return;
    }
    if (activeProject && activeProject.activePath !== selected) {
      discardDraftsForProject(activeProject.activePath);
    }

    resetProjectSelection();

    const nextProjects = upsertProject(projects, selected);
    setProjects(nextProjects);
    setActiveProjectId(
      nextProjects.find((project) => project.rootPath === selected)?.id ??
        nextProjects.at(-1)?.id ??
        null,
    );
    setProjectSwitcherOpen(false);
  }, [
    activeProject,
    confirmDiscardProjectDrafts,
    discardDraftsForProject,
    projects,
    resetProjectSelection,
    setActiveProjectId,
    setProjectSwitcherOpen,
    setProjects,
  ]);

  const removeProject = useCallback(
    (projectId: string) => {
      const project = projects.find((current) => current.id === projectId);
      if (
        project &&
        !confirmDiscardProjectDrafts(project.activePath, `remove ${project.name}`)
      ) {
        return;
      }

      const remaining = projects.filter((project) => project.id !== projectId);
      setProjects(remaining);
      if (project) {
        discardDraftsForProject(project.activePath);
      }
      if (activeProjectId === projectId) {
        setActiveProjectId(remaining[0]?.id ?? null);
        resetProjectSelection();
      }
    },
    [
      activeProjectId,
      confirmDiscardProjectDrafts,
      discardDraftsForProject,
      projects,
      resetProjectSelection,
      setActiveProjectId,
      setProjects,
    ],
  );

  const selectProject = useCallback(
    (project: SavedProject) => {
      if (
        activeProject &&
        activeProject.id !== project.id &&
        !confirmDiscardProjectDrafts(
          activeProject.activePath,
          `switch to ${project.name}`,
        )
      ) {
        return;
      }
      if (activeProject && activeProject.id !== project.id) {
        discardDraftsForProject(activeProject.activePath);
      }

      setActiveProjectId(project.id);
      setProjectSwitcherOpen(false);
      resetProjectSelection();
    },
    [
      activeProject,
      confirmDiscardProjectDrafts,
      discardDraftsForProject,
      resetProjectSelection,
      setActiveProjectId,
      setProjectSwitcherOpen,
    ],
  );

  const selectProjectPath = useCallback(
    (rootPath: string, activePath: string, action: string) => {
      if (
        activeProject &&
        activeProject.activePath !== activePath &&
        !confirmDiscardProjectDrafts(activeProject.activePath, action)
      ) {
        return false;
      }
      if (activeProject && activeProject.activePath !== activePath) {
        discardDraftsForProject(activeProject.activePath);
      }

      const next = activateProjectPath(projects, rootPath, activePath);
      setProjects(next.projects);
      setActiveProjectId(next.projectId);
      setProjectSwitcherOpen(false);
      resetProjectSelection();
      return true;
    },
    [
      activeProject,
      confirmDiscardProjectDrafts,
      discardDraftsForProject,
      projects,
      resetProjectSelection,
      setActiveProjectId,
      setProjectSwitcherOpen,
      setProjects,
    ],
  );

  return {
    chooseRepository,
    removeProject,
    selectProject,
    selectProjectPath,
  };
}
