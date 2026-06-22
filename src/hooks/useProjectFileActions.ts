import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  createProjectFile,
  deleteProjectFile,
  pasteClipboardIntoProject,
  pasteProjectFiles,
  renameProjectFile,
  writePastedFiles,
  type PastedFile,
} from "../lib/api";
import { confirmNativeDialog, showNativeMessage } from "../lib/nativeDialogs";
import { buildRequestedFilePath } from "../lib/pathLabels";
import type { PreviewMode } from "../lib/previewTabs";
import type { SavedProject } from "../lib/projects";
import { useProjectFileStateRefresh } from "./useProjectFileStateRefresh";

/// Cap pasted file size so a huge file does not flood the IPC channel with a
/// multi-megabyte JSON number array.
const MAX_PASTED_FILE_BYTES = 10 * 1024 * 1024;

interface CopiedProjectFiles {
  readonly clipboardText: string;
  readonly paths: readonly string[];
  readonly sourceProjectPath: string;
}

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
  readonly copyFileFromTree: (path: string | null) => Promise<void>;
  readonly createFileFromTree: (parentPath: string | null) => Promise<void>;
  readonly deleteFileFromTree: (path: string) => Promise<void>;
  readonly pasteClipboardFromTree: (destDir: string | null) => Promise<void>;
  readonly pasteFilesFromTree: (
    files: File[],
    destDir: string | null,
  ) => Promise<void>;
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
  const refreshProjectFileState = useProjectFileStateRefresh();
  const copiedProjectFilesRef = useRef<CopiedProjectFiles | null>(null);

  const revealPastedFiles = useCallback(
    async (projectPath: string, written: readonly string[]) => {
      await refreshProjectFileState(projectPath);
      const firstPath = written[0];
      if (firstPath) {
        openPreviewTab("file", firstPath);
      }
    },
    [openPreviewTab, refreshProjectFileState],
  );

  const pasteFilesFromTree = useCallback(
    async (files: File[], destDir: string | null) => {
      if (!activeProject || files.length === 0) {
        return;
      }

      const pasteable: PastedFile[] = [];
      let skippedTooLarge = 0;
      for (const file of files) {
        if (file.size > MAX_PASTED_FILE_BYTES) {
          skippedTooLarge += 1;
          continue;
        }
        const name = file.name?.trim();
        if (!name) {
          continue;
        }
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          pasteable.push({ relativePath: name, bytes });
        } catch {
          // Skip files that cannot be read.
        }
      }

      if (pasteable.length === 0) {
        await showNativeMessage(
          skippedTooLarge > 0
            ? `Skipped ${skippedTooLarge} file(s) larger than ${MAX_PASTED_FILE_BYTES / (1024 * 1024)} MB.`
            : "No pastable files were found on the clipboard.",
          { kind: "warning" },
        );
        return;
      }

      try {
        const written = await writePastedFiles(
          activeProject.activePath,
          destDir,
          pasteable,
        );
        await revealPastedFiles(activeProject.activePath, written);
      } catch (error) {
        await showNativeMessage(
          error instanceof Error ? error.message : String(error),
          { kind: "error" },
        );
        await refreshProjectFileState(activeProject.activePath);
      }
    },
    [activeProject, refreshProjectFileState, revealPastedFiles],
  );

  const pasteClipboardFromTree = useCallback(
    async (destDir: string | null) => {
      if (!activeProject) {
        return;
      }

      const copiedProjectFiles = await copiedProjectFilesForPaste(
        copiedProjectFilesRef,
      );
      if (copiedProjectFiles) {
        try {
          const written = await pasteProjectFiles(
            activeProject.activePath,
            copiedProjectFiles.sourceProjectPath,
            copiedProjectFiles.paths,
            destDir,
          );
          await revealPastedFiles(activeProject.activePath, written);
        } catch (error) {
          await showNativeMessage(
            error instanceof Error ? error.message : String(error),
            { kind: "error" },
          );
          await refreshProjectFileState(activeProject.activePath);
        }
        return;
      }

      try {
        const written = await pasteClipboardIntoProject(
          activeProject.activePath,
          destDir,
        );
        await revealPastedFiles(activeProject.activePath, written);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await showNativeMessage(message, {
          kind:
            message === "No clipboard files or image found" ? "warning" : "error",
        });
      }
    },
    [activeProject, refreshProjectFileState, revealPastedFiles],
  );

  const copyFileFromTree = useCallback(
    async (filePath: string | null) => {
      if (!activeProject || !filePath) {
        return;
      }

      const clipboardText = projectFileClipboardText(
        activeProject.activePath,
        [filePath],
      );
      copiedProjectFilesRef.current = {
        clipboardText,
        paths: [filePath],
        sourceProjectPath: activeProject.activePath,
      };

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard
          .writeText(clipboardText)
          .catch(() => undefined);
      }
    },
    [activeProject],
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
    copyFileFromTree,
    createFileFromTree,
    deleteFileFromTree,
    pasteClipboardFromTree,
    pasteFilesFromTree,
    refreshProjectFileState,
    renameFileFromTree,
  };
}

async function copiedProjectFilesForPaste(
  copiedProjectFilesRef: MutableRefObject<CopiedProjectFiles | null>,
): Promise<CopiedProjectFiles | null> {
  const copiedProjectFiles = copiedProjectFilesRef.current;
  if (!copiedProjectFiles) {
    return null;
  }

  if (!navigator.clipboard?.readText) {
    return copiedProjectFiles;
  }

  try {
    const clipboardText = await navigator.clipboard.readText();
    if (clipboardText === copiedProjectFiles.clipboardText) {
      return copiedProjectFiles;
    }
    copiedProjectFilesRef.current = null;
    return null;
  } catch {
    return copiedProjectFiles;
  }
}

function projectFileClipboardText(
  projectPath: string,
  filePaths: readonly string[],
): string {
  return filePaths
    .map((filePath) => absoluteProjectFilePath(projectPath, filePath))
    .join("\n");
}

function absoluteProjectFilePath(projectPath: string, filePath: string): string {
  const root = projectPath.replace(/[\\/]+$/, "");
  const relative = filePath.replace(/^\/+/, "");
  return `${root}/${relative}`;
}
