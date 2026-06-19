import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  restoreFiles,
  saveFileContent,
  stageFiles,
  unstageFiles,
  type RestoreMode,
} from "../lib/api";
import { editorDraftKey, isDraftDirty } from "../lib/editorDrafts";
import type { EditorDraft } from "../lib/editorTypes";
import { confirmNativeDialog, showNativeMessage } from "../lib/nativeDialogs";
import type { SavedProject } from "../lib/projects";
import {
  gitWriteOperationPendingTitle,
  type GitFileActionKind,
  type GitWriteGuard,
  type GitWriteOperation,
} from "./useGitWriteGuard";
import { useProjectFileStateRefresh } from "./useProjectFileStateRefresh";

export type { GitFileActionKind } from "./useGitWriteGuard";

export interface GitFilePendingAction {
  readonly kind: GitFileActionKind;
  readonly path: string;
}

export interface UseGitFileActionsOptions {
  readonly activeProject: SavedProject | undefined;
  readonly discardDraftForPath: (projectPath: string, filePath: string) => void;
  readonly editorDrafts: Record<string, EditorDraft>;
  readonly gitWriteGuard: GitWriteGuard;
  readonly hasGitRepository: boolean;
  readonly removePreviewTabsForPath: (path: string) => void;
  readonly selectedProjectPath: string | null;
  readonly setSelectedProjectPath: Dispatch<SetStateAction<string | null>>;
}

export interface GitFileActions {
  readonly canRunGitFileAction: boolean;
  readonly gitFileActionError: string | null;
  readonly gitFileActionPending: GitFilePendingAction | null;
  readonly gitFileActionPendingTitle: string | null;
  readonly restoreFile: (
    filePath: string,
    mode?: RestoreMode,
  ) => Promise<boolean>;
  readonly stageFile: (filePath: string) => Promise<boolean>;
  readonly unstageFile: (filePath: string) => Promise<boolean>;
}

type GitFileActionRunner = (projectPath: string) => Promise<boolean>;

export function useGitFileActions({
  activeProject,
  discardDraftForPath,
  editorDrafts,
  gitWriteGuard,
  hasGitRepository,
  removePreviewTabsForPath,
  selectedProjectPath,
  setSelectedProjectPath,
}: UseGitFileActionsOptions): GitFileActions {
  const refreshProjectFileState = useProjectFileStateRefresh();
  const [gitFileActionError, setGitFileActionError] = useState<string | null>(
    null,
  );
  const { beginGitWrite, endGitWrite, pendingOperation } = gitWriteGuard;
  const gitFileActionPending =
    pendingOperation?.scope === "file"
      ? {
          kind: pendingOperation.kind,
          path: pendingOperation.path,
        }
      : null;
  const gitFileActionPendingTitle =
    gitWriteOperationPendingTitle(pendingOperation);

  const runGitFileAction = useCallback(
    async (
      kind: GitFileActionKind,
      filePath: string,
      runner: GitFileActionRunner,
    ): Promise<boolean> => {
      const operation = {
        kind,
        path: filePath,
        scope: "file",
      } satisfies GitWriteOperation;

      if (!activeProject || !hasGitRepository || !beginGitWrite(operation)) {
        return false;
      }

      const projectPath = activeProject.activePath;
      setGitFileActionError(null);
      let shouldRefresh = false;

      try {
        const completed = await runner(projectPath);
        shouldRefresh = completed;
        return completed;
      } catch (error) {
        shouldRefresh = true;
        const message = errorMessage(error);
        setGitFileActionError(message);
        await showNativeMessage(message, { kind: "error" });
        return false;
      } finally {
        if (shouldRefresh) {
          await refreshProjectFileState(projectPath);
        }
        endGitWrite(operation);
      }
    },
    [
      activeProject,
      beginGitWrite,
      endGitWrite,
      hasGitRepository,
      refreshProjectFileState,
    ],
  );

  const saveDirtyDraftBeforeStage = useCallback(
    async (projectPath: string, filePath: string): Promise<boolean> => {
      const draft = editorDrafts[editorDraftKey(projectPath, filePath)];
      if (!isDraftDirty(draft)) {
        return true;
      }

      const confirmed = await confirmNativeDialog(
        `${filePath} has unsaved editor changes. Save it before staging?`,
        {
          cancelLabel: "Cancel",
          kind: "warning",
          okLabel: "Save",
        },
      );
      if (!confirmed) {
        return false;
      }

      const baseContent = draft.conflict
        ? draft.conflict.currentContent
        : draft.baseContent;
      const response = await saveFileContent(
        projectPath,
        filePath,
        baseContent,
        draft.content,
      );

      if (response.status === "conflict") {
        await refreshProjectFileState(projectPath);
        await showNativeMessage(
          `${filePath} changed on disk. Resolve the save conflict before staging.`,
          { kind: "warning" },
        );
        return false;
      }

      discardDraftForPath(projectPath, filePath);
      return true;
    },
    [discardDraftForPath, editorDrafts, refreshProjectFileState],
  );

  const stageFile = useCallback(
    (filePath: string) =>
      runGitFileAction("stage", filePath, async (projectPath) => {
        const canStage = await saveDirtyDraftBeforeStage(projectPath, filePath);
        if (!canStage) {
          return false;
        }

        await stageFiles({ path: projectPath, paths: [filePath] });
        return true;
      }),
    [runGitFileAction, saveDirtyDraftBeforeStage],
  );

  const unstageFile = useCallback(
    (filePath: string) =>
      runGitFileAction("unstage", filePath, async (projectPath) => {
        await unstageFiles({ path: projectPath, paths: [filePath] });
        return true;
      }),
    [runGitFileAction],
  );

  const restoreFile = useCallback(
    (filePath: string, mode: RestoreMode = "worktree") =>
      runGitFileAction("restore", filePath, async (projectPath) => {
        const confirmed = await confirmNativeDialog(
          `Discard changes in ${filePath}? This cannot be undone.`,
          {
            cancelLabel: "Cancel",
            kind: "warning",
            okLabel: "Discard",
          },
        );
        if (!confirmed) {
          return false;
        }

        await restoreFiles({ path: projectPath, paths: [filePath], mode });
        discardDraftForPath(projectPath, filePath);
        removePreviewTabsForPath(filePath);
        if (selectedProjectPath === filePath) {
          setSelectedProjectPath(null);
        }
        return true;
      }),
    [
      discardDraftForPath,
      removePreviewTabsForPath,
      runGitFileAction,
      selectedProjectPath,
      setSelectedProjectPath,
    ],
  );

  return {
    canRunGitFileAction: Boolean(activeProject && hasGitRepository && !pendingOperation),
    gitFileActionError,
    gitFileActionPending,
    gitFileActionPendingTitle,
    restoreFile,
    stageFile,
    unstageFile,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
