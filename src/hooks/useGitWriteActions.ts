import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  createCommit,
  pushCurrentBranch,
  type BranchInfo,
  type RepositoryPayload,
} from "../lib/api";
import { countDirtyDraftsForProject } from "../lib/editorDrafts";
import type { EditorDraft } from "../lib/editorTypes";
import { confirmNativeDialog, showNativeMessage } from "../lib/nativeDialogs";
import type { SavedProject } from "../lib/projects";
import {
  commitDirtyDraftWarning,
  commitDisabledReason as commitReason,
  countConflictFiles,
  countStagedFiles,
  currentRepositoryBranch,
  pushDisabledReason as pushReason,
  type GitRepositoryWriteKind,
} from "./gitWriteAvailability";
import { useProjectFileStateRefresh } from "./useProjectFileStateRefresh";
import {
  gitWriteOperationPendingTitle,
  type GitWriteGuard,
  type GitWriteOperation,
} from "./useGitWriteGuard";

export interface UseGitWriteActionsOptions {
  readonly activeProject: SavedProject | undefined;
  readonly editorDrafts: Record<string, EditorDraft>;
  readonly gitWriteGuard: GitWriteGuard;
  readonly repositoryPayload: RepositoryPayload | undefined;
}

export interface GitWriteActions {
  readonly canCommit: boolean;
  readonly canPush: boolean;
  readonly commitDisabledReason: string | null;
  readonly commitError: string | null;
  readonly commitMessage: string;
  readonly commitPending: boolean;
  readonly commitStagedChanges: () => Promise<boolean>;
  readonly commitWarning: string | null;
  readonly conflictCount: number;
  readonly currentBranch: BranchInfo | null;
  readonly dirtyDraftCount: number;
  readonly gitWritePendingReason: string | null;
  readonly pendingGitWriteAction: GitRepositoryWriteKind | null;
  readonly pushCurrentBranchToUpstream: () => Promise<boolean>;
  readonly pushDisabledReason: string | null;
  readonly pushError: string | null;
  readonly pushPending: boolean;
  readonly setCommitMessage: Dispatch<SetStateAction<string>>;
  readonly stagedCount: number;
}

export function useGitWriteActions({
  activeProject,
  editorDrafts,
  gitWriteGuard,
  repositoryPayload,
}: UseGitWriteActionsOptions): GitWriteActions {
  const activeProjectPath = activeProject?.activePath ?? null;
  const refreshProjectFileState = useProjectFileStateRefresh();
  const [commitMessage, setCommitMessage] = useState("");
  const [commitError, setCommitError] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const { beginGitWrite, endGitWrite, pendingOperation } = gitWriteGuard;
  const pendingGitWriteAction =
    pendingOperation?.scope === "repository" ? pendingOperation.kind : null;
  const gitWritePendingReason =
    gitWriteOperationPendingTitle(pendingOperation);

  const stagedCount = useMemo(
    () => countStagedFiles(repositoryPayload?.files ?? []),
    [repositoryPayload?.files],
  );
  const conflictCount = useMemo(
    () => countConflictFiles(repositoryPayload?.files ?? []),
    [repositoryPayload?.files],
  );
  const dirtyDraftCount = useMemo(
    () =>
      activeProjectPath
        ? countDirtyDraftsForProject(editorDrafts, activeProjectPath)
        : 0,
    [activeProjectPath, editorDrafts],
  );
  const currentBranch = useMemo(
    () =>
      currentRepositoryBranch(repositoryPayload?.summary.branches),
    [repositoryPayload?.summary.branches],
  );
  const trimmedCommitMessage = commitMessage.trim();
  const commitDisabledReason = commitReason({
    activeProjectPath,
    conflictCount,
    pendingOperation,
    stagedCount,
    trimmedMessage: trimmedCommitMessage,
  });
  const pushDisabledReason = pushReason({
    activeProjectPath,
    branch: currentBranch,
    pendingOperation,
  });
  const commitWarning = commitDirtyDraftWarning(dirtyDraftCount);

  const commitStagedChanges = useCallback(async (): Promise<boolean> => {
    if (commitDisabledReason) {
      setCommitError(commitDisabledReason);
      await showNativeMessage(commitDisabledReason, { kind: "warning" });
      return false;
    }
    const operation = {
      kind: "commit",
      scope: "repository",
    } satisfies GitWriteOperation;
    if (!activeProjectPath || !beginGitWrite(operation)) {
      return false;
    }

    setCommitError(null);
    setPushError(null);
    let shouldRefresh = false;

    try {
      if (commitWarning) {
        const confirmed = await confirmNativeDialog(commitWarning, {
          cancelLabel: "Cancel",
          kind: "warning",
          okLabel: "Commit staged content",
        });
        if (!confirmed) {
          return false;
        }
      }

      shouldRefresh = true;
      await createCommit({
        message: trimmedCommitMessage,
        path: activeProjectPath,
      });
      setCommitMessage("");
      return true;
    } catch (error) {
      const message = errorMessage(error);
      setCommitError(message);
      await showNativeMessage(message, { kind: "error" });
      return false;
    } finally {
      if (shouldRefresh) {
        await refreshProjectFileState(activeProjectPath);
      }
      endGitWrite(operation);
    }
  }, [
    activeProjectPath,
    beginGitWrite,
    commitDisabledReason,
    commitWarning,
    endGitWrite,
    refreshProjectFileState,
    trimmedCommitMessage,
  ]);

  const pushCurrentBranchToUpstream = useCallback(async (): Promise<boolean> => {
    if (pushDisabledReason) {
      setPushError(pushDisabledReason);
      await showNativeMessage(pushDisabledReason, { kind: "warning" });
      return false;
    }
    const operation = {
      kind: "push",
      scope: "repository",
    } satisfies GitWriteOperation;
    if (!activeProjectPath || !beginGitWrite(operation)) {
      return false;
    }

    setCommitError(null);
    setPushError(null);
    let shouldRefresh = false;

    try {
      shouldRefresh = true;
      await pushCurrentBranch(activeProjectPath);
      return true;
    } catch (error) {
      const message = errorMessage(error);
      setPushError(message);
      await showNativeMessage(message, { kind: "error" });
      return false;
    } finally {
      if (shouldRefresh) {
        await refreshProjectFileState(activeProjectPath);
      }
      endGitWrite(operation);
    }
  }, [
    activeProjectPath,
    beginGitWrite,
    endGitWrite,
    pushDisabledReason,
    refreshProjectFileState,
  ]);

  return {
    canCommit: commitDisabledReason === null,
    canPush: pushDisabledReason === null,
    commitDisabledReason,
    commitError,
    commitMessage,
    commitPending: pendingGitWriteAction === "commit",
    commitStagedChanges,
    commitWarning,
    conflictCount,
    currentBranch,
    dirtyDraftCount,
    gitWritePendingReason,
    pendingGitWriteAction,
    pushCurrentBranchToUpstream,
    pushDisabledReason,
    pushError,
    pushPending: pendingGitWriteAction === "push",
    setCommitMessage,
    stagedCount,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
