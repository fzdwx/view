import { useCallback, type Dispatch, type SetStateAction } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  createProjectFile,
  deleteProjectFile,
  renameProjectFile,
} from "../lib/api";
import { confirmNativeDialog, showNativeMessage } from "../lib/nativeDialogs";
import { buildRequestedFilePath } from "../lib/pathLabels";
import type { PreviewMode } from "../lib/previewTabs";
import type { SavedProject } from "../lib/projects";

export interface UseProjectFileActionsOptions {
  readonly activeProject: SavedProject | undefined;
  readonly discardDraftForPath: (projectPath: string, filePath: string) => void;
  readonly isFileDraftDirty: (projectPath: string, filePath: string) => boolean;
  readonly moveEditorDraftPath: (
    projectPath: string,
    fromPath: string,
    toPath: string,
  ) => void;
  readonly movePreviewTabPath: (fromPath: string, toPath: string) => void;
  readonly openPreviewTab: (
    mode: PreviewMode,
    path: string,
    targetLine?: number | null,
  ) => void;
  readonly removePreviewTabsForPath: (path: string) => void;
  readonly selectedProjectPath: string | null;
  readonly setSelectedProjectPath: Dispatch<SetStateAction<string | null>>;
}

export interface ProjectFileActions {
  readonly createFileFromTree: (parentPath: string | null) => Promise<void>;
  readonly deleteFileFromTree: (path: string) => Promise<void>;
  readonly refreshProjectFileState: (projectPath: string) => Promise<void>;
  readonly renameFileFromTree: (
    fromPath: string,
    toPath: string,
  ) => Promise<void>;
}

export function useProjectFileActions({
  activeProject,
  discardDraftForPath,
  isFileDraftDirty,
  moveEditorDraftPath,
  movePreviewTabPath,
  openPreviewTab,
  removePreviewTabsForPath,
  selectedProjectPath,
  setSelectedProjectPath,
}: UseProjectFileActionsOptions): ProjectFileActions {
  const queryClient = useQueryClient();

  const refreshProjectFileState = useCallback(
    async (projectPath: string) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["commits", projectPath] }),
        queryClient.invalidateQueries({ queryKey: ["project-files", projectPath] }),
        queryClient.invalidateQueries({ queryKey: ["repository", projectPath] }),
        queryClient.invalidateQueries({ queryKey: ["file-content", projectPath] }),
        queryClient.invalidateQueries({
          queryKey: ["file-worktree-diff", projectPath],
        }),
        queryClient.invalidateQueries({ queryKey: ["file-diff", projectPath] }),
      ]);
    },
    [queryClient],
  );

  const createFileFromTree = useCallback(
    async (parentPath: string | null) => {
      if (!activeProject) {
        return;
      }

      const input = window.prompt(
        parentPath ? `New file path in ${parentPath}` : "New file path",
        "untitled.txt",
      );
      if (input === null) {
        return;
      }

      const requestedPath = buildRequestedFilePath(parentPath, input);
      if (!requestedPath) {
        return;
      }

      try {
        const createdPath = await createProjectFile(
          activeProject.activePath,
          requestedPath,
        );
        await refreshProjectFileState(activeProject.activePath);
        openPreviewTab("file", createdPath);
      } catch (error) {
        await showNativeMessage(
          error instanceof Error ? error.message : String(error),
          { kind: "error" },
        );
      }
    },
    [activeProject, openPreviewTab, refreshProjectFileState],
  );

  const renameFileFromTree = useCallback(
    async (fromPath: string, toPath: string) => {
      if (!activeProject || fromPath === toPath) {
        return;
      }

      if (isFileDraftDirty(activeProject.activePath, fromPath)) {
        const confirmed = await confirmNativeDialog(
          `Rename ${fromPath} and discard unsaved editor changes?`,
          {
            cancelLabel: "Cancel",
            kind: "warning",
            okLabel: "Rename",
          },
        );
        if (!confirmed) {
          return;
        }
        discardDraftForPath(activeProject.activePath, fromPath);
      }

      try {
        const renamedPath = await renameProjectFile(
          activeProject.activePath,
          fromPath,
          toPath,
        );
        movePreviewTabPath(fromPath, renamedPath);
        moveEditorDraftPath(activeProject.activePath, fromPath, renamedPath);
        if (selectedProjectPath === fromPath) {
          setSelectedProjectPath(renamedPath);
        }
        await refreshProjectFileState(activeProject.activePath);
      } catch (error) {
        await showNativeMessage(
          error instanceof Error ? error.message : String(error),
          { kind: "error" },
        );
        await refreshProjectFileState(activeProject.activePath);
      }
    },
    [
      activeProject,
      discardDraftForPath,
      isFileDraftDirty,
      moveEditorDraftPath,
      movePreviewTabPath,
      refreshProjectFileState,
      selectedProjectPath,
      setSelectedProjectPath,
    ],
  );

  const deleteFileFromTree = useCallback(
    async (path: string) => {
      if (!activeProject) {
        return;
      }

      const confirmed = await confirmNativeDialog(`Delete ${path}?`, {
        cancelLabel: "Cancel",
        kind: "warning",
        okLabel: "Delete",
      });
      if (!confirmed) {
        return;
      }

      if (isFileDraftDirty(activeProject.activePath, path)) {
        const discardConfirmed = await confirmNativeDialog(
          `${path} has unsaved editor changes. Delete it and discard those changes?`,
          {
            cancelLabel: "Cancel",
            kind: "warning",
            okLabel: "Delete",
          },
        );
        if (!discardConfirmed) {
          return;
        }
      }

      try {
        await deleteProjectFile(activeProject.activePath, path);
        discardDraftForPath(activeProject.activePath, path);
        removePreviewTabsForPath(path);
        await refreshProjectFileState(activeProject.activePath);
      } catch (error) {
        await showNativeMessage(
          error instanceof Error ? error.message : String(error),
          { kind: "error" },
        );
      }
    },
    [
      activeProject,
      discardDraftForPath,
      isFileDraftDirty,
      refreshProjectFileState,
      removePreviewTabsForPath,
    ],
  );

  return {
    createFileFromTree,
    deleteFileFromTree,
    refreshProjectFileState,
    renameFileFromTree,
  };
}
