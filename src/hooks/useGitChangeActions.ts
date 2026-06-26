import { useCallback, useState } from "react";
import {
  applyFileChange,
  type GitChangeOperation,
  type GitChangeSource,
} from "../lib/api";
import { editorDraftKey, isDraftDirty } from "../lib/editorDrafts";
import type { EditorDraft, EditorGitMarker } from "../lib/editorTypes";
import { confirmNativeDialog, showNativeMessage } from "../lib/nativeDialogs";
import type { SavedProject } from "../lib/projects";
import { saveDirtyDraftBeforeStage } from "./saveDirtyDraftBeforeStage";
import {
  gitWriteOperationPendingTitle,
  type GitFileActionKind,
  type GitWriteGuard,
  type GitWriteOperation,
} from "./useGitWriteGuard";
import { useProjectFileStateRefresh } from "./useProjectFileStateRefresh";

export interface UseGitChangeActionsOptions {
  readonly activeProject: SavedProject | undefined;
  readonly discardDraftForPath: (projectPath: string, filePath: string) => void;
  readonly editorDrafts: Record<string, EditorDraft>;
  readonly gitWriteGuard: GitWriteGuard;
  readonly hasGitRepository: boolean;
}

export interface GitChangeActions {
  readonly canRunGitChangeAction: boolean;
  readonly gitChangeActionError: string | null;
  readonly gitChangeActionPendingTitle: string | null;
  readonly discardChange: (filePath: string, marker: EditorGitMarker) => Promise<boolean>;
  readonly stageChange: (filePath: string, marker: EditorGitMarker) => Promise<boolean>;
  readonly unstageChange: (filePath: string, marker: EditorGitMarker) => Promise<boolean>;
}

export function useGitChangeActions({
  activeProject,
  discardDraftForPath,
  editorDrafts,
  gitWriteGuard,
  hasGitRepository,
}: UseGitChangeActionsOptions): GitChangeActions {
  const refreshProjectFileState = useProjectFileStateRefresh();
  const [gitChangeActionError, setGitChangeActionError] = useState<string | null>(
    null,
  );
  const { beginGitWrite, endGitWrite, pendingOperation } = gitWriteGuard;

  const runChangeAction = useCallback(
    async (
      filePath: string,
      marker: EditorGitMarker,
      operation: GitChangeOperation,
      kind: GitFileActionKind,
    ): Promise<boolean> => {
      const projectPath = activeProject?.activePath;
      const source = marker.source;
      const operationState = {
        kind,
        path: filePath,
        scope: "file",
      } satisfies GitWriteOperation;

      if (!projectPath || !hasGitRepository || !beginGitWrite(operationState)) {
        return false;
      }

      setGitChangeActionError(null);
      let shouldRefresh = false;

      try {
        const prepared = await prepareChangeAction({
          discardDraftForPath,
          editorDrafts,
          filePath,
          marker,
          operation,
          projectPath,
          refreshProjectFileState,
          source,
        });
        if (!prepared) {
          return false;
        }

        await applyFileChange({
          path: projectPath,
          filePath,
          source,
          operation,
          oldStart: marker.oldStart,
          oldLineCount: marker.oldLineCount,
          newStart: marker.newStart,
          newLineCount: marker.newLineCount,
        });
        if (operation === "discard") {
          discardDraftForPath(projectPath, filePath);
        }
        shouldRefresh = true;
        return true;
      } catch (error) {
        shouldRefresh = true;
        const message = errorMessage(error);
        setGitChangeActionError(message);
        await showNativeMessage(message, { kind: "error" });
        return false;
      } finally {
        if (shouldRefresh) {
          await refreshProjectFileState(projectPath);
        }
        endGitWrite(operationState);
      }
    },
    [
      activeProject?.activePath,
      beginGitWrite,
      discardDraftForPath,
      editorDrafts,
      endGitWrite,
      hasGitRepository,
      refreshProjectFileState,
    ],
  );

  const stageChange = useCallback(
    (filePath: string, marker: EditorGitMarker) =>
      runChangeAction(filePath, marker, "stage", "stage"),
    [runChangeAction],
  );
  const unstageChange = useCallback(
    (filePath: string, marker: EditorGitMarker) =>
      runChangeAction(filePath, marker, "unstage", "unstage"),
    [runChangeAction],
  );
  const discardChange = useCallback(
    (filePath: string, marker: EditorGitMarker) =>
      runChangeAction(filePath, marker, "discard", "restore"),
    [runChangeAction],
  );

  return {
    canRunGitChangeAction: Boolean(
      activeProject && hasGitRepository && !pendingOperation,
    ),
    gitChangeActionError,
    gitChangeActionPendingTitle: gitWriteOperationPendingTitle(pendingOperation),
    discardChange,
    stageChange,
    unstageChange,
  };
}

async function prepareChangeAction({
  discardDraftForPath,
  editorDrafts,
  filePath,
  marker,
  operation,
  projectPath,
  refreshProjectFileState,
  source,
}: {
  readonly discardDraftForPath: (projectPath: string, filePath: string) => void;
  readonly editorDrafts: Record<string, EditorDraft>;
  readonly filePath: string;
  readonly marker: EditorGitMarker;
  readonly operation: GitChangeOperation;
  readonly projectPath: string;
  readonly refreshProjectFileState: (projectPath: string) => Promise<void>;
  readonly source: GitChangeSource;
}): Promise<boolean> {
  if (operation === "stage") {
    return saveDirtyDraftBeforeStage({
      discardDraftForPath,
      editorDrafts,
      filePath,
      projectPath,
      refreshProjectFileState,
    });
  }

  if (operation === "discard") {
    const draft = editorDrafts[editorDraftKey(projectPath, filePath)];
    if (isDraftDirty(draft)) {
      await showNativeMessage(
        `${filePath} has unsaved editor changes. Save or discard the draft before discarding a Git change.`,
        { kind: "warning" },
      );
      return false;
    }

    return confirmNativeDialog(
      `Discard ${gitMarkerScopeLabel(marker)} in ${filePath}? This cannot be undone.`,
      {
        cancelLabel: "Cancel",
        kind: "warning",
        okLabel: "Discard",
      },
    );
  }

  return source === "staged";
}

function gitMarkerScopeLabel(marker: EditorGitMarker): string {
  if (marker.lineCount === 1) {
    return `line ${marker.line}`;
  }
  const endLine = marker.line + marker.lineCount - 1;
  return `lines ${marker.line}-${endLine}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
