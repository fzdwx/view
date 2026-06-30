import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  abortGitOperation,
  cherryPickCommit,
  continueGitOperation,
  createCommit,
  getGitOperationState,
  resetHardToReflog,
  pushCurrentBranch,
  revertCommit,
  skipGitOperation,
  type BranchInfo,
  type GitOperationState,
  type RepositoryPayload,
  type TreeFile,
} from "../lib/api";
import { countDirtyDraftsForProject } from "../lib/editorDrafts";
import type { EditorDraft } from "../lib/editorTypes";
import { confirmNativeDialog, showNativeMessage } from "../lib/nativeDialogs";
import type { SavedProject } from "../lib/projects";
import {
  forceWithLeaseConfirmation,
  publishBranchLabel,
} from "../lib/remoteActions";
import {
  commitDirtyDraftWarning,
  commitDisabledReason as commitReason,
  commitMessageLint,
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
  readonly hasGitRepository: boolean;
  readonly repositoryPayload: RepositoryPayload | undefined;
  readonly worktreeFiles: readonly TreeFile[];
}

export interface GitWriteActions {
  readonly canCommit: boolean;
  readonly canPush: boolean;
  readonly commitDisabledReason: string | null;
  readonly commitError: string | null;
  readonly commitMessageHint: string | null;
  readonly commitMessage: string;
  readonly commitPending: boolean;
  readonly cherryPickHistoryCommit: (hash: string) => Promise<boolean>;
  readonly commitStagedChanges: () => Promise<boolean>;
  readonly commitWarning: string | null;
  readonly conflictCount: number;
  readonly currentBranch: BranchInfo | null;
  readonly dirtyDraftCount: number;
  readonly gitWritePendingReason: string | null;
  readonly gitOperationError: string | null;
  readonly gitOperationPending: boolean;
  readonly gitOperationState: GitOperationState | null;
  readonly pendingGitWriteAction: GitRepositoryWriteKind | null;
  readonly historyOperationDisabledReason: string | null;
  readonly historyOperationError: string | null;
  readonly historyOperationPending: boolean;
  readonly abortGitOperationInProgress: () => Promise<boolean>;
  readonly continueGitOperationInProgress: () => Promise<boolean>;
  readonly forcePushCurrentBranchWithLease: () => Promise<boolean>;
  readonly publishCurrentBranchToRemote: () => Promise<boolean>;
  readonly pushCurrentBranchToUpstream: () => Promise<boolean>;
  readonly pushDisabledReason: string | null;
  readonly pushError: string | null;
  readonly pushPending: boolean;
  readonly resetDisabledReason: string | null;
  readonly resetError: string | null;
  readonly resetHardToReflogEntry: (selector: string) => Promise<boolean>;
  readonly resetPending: boolean;
  readonly revertHistoryCommit: (hash: string) => Promise<boolean>;
  readonly setCommitMessage: Dispatch<SetStateAction<string>>;
  readonly skipGitOperationInProgress: () => Promise<boolean>;
  readonly stagedCount: number;
}

export function useGitWriteActions({
  activeProject,
  editorDrafts,
  gitWriteGuard,
  hasGitRepository,
  repositoryPayload,
  worktreeFiles,
}: UseGitWriteActionsOptions): GitWriteActions {
  const activeProjectPath = activeProject?.activePath ?? null;
  const refreshProjectFileState = useProjectFileStateRefresh();
  const [commitMessage, setCommitMessage] = useState("");
  const [commitError, setCommitError] = useState<string | null>(null);
  const [gitOperationError, setGitOperationError] = useState<string | null>(null);
  const [historyOperationError, setHistoryOperationError] =
    useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const { beginGitWrite, endGitWrite, pendingOperation } = gitWriteGuard;
  const pendingGitWriteAction =
    pendingOperation?.scope === "repository" ? pendingOperation.kind : null;
  const gitWritePendingReason =
    gitWriteOperationPendingTitle(pendingOperation);
  const gitOperationQuery = useQuery({
    queryKey: ["git-operation-state", activeProjectPath],
    queryFn: () => getGitOperationState(requireActiveProjectPath(activeProjectPath)),
    enabled: Boolean(activeProjectPath && hasGitRepository),
    retry: false,
  });
  const gitOperationState =
    gitOperationQuery.data?.kind ? gitOperationQuery.data : null;

  const stagedCount = useMemo(
    () => countStagedFiles(worktreeFiles),
    [worktreeFiles],
  );
  const conflictCount = useMemo(
    () => countConflictFiles(worktreeFiles),
    [worktreeFiles],
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
  const defaultRemoteName = useMemo(
    () => defaultRemoteForBranch(currentBranch, repositoryPayload),
    [currentBranch, repositoryPayload],
  );
  const trimmedCommitMessage = commitMessage.trim();
  const hasNulByte = commitMessage.includes("\0");
  const commitDisabledReason = commitReason({
    activeProjectPath,
    conflictCount,
    hasGitRepository,
    hasNulByte,
    pendingOperation,
    stagedCount,
    trimmedMessage: trimmedCommitMessage,
  });
  const commitMessageHint = commitMessageLint(commitMessage);
  const pushDisabledReason = pushReason({
    activeProjectPath,
    branch: currentBranch,
    hasGitRepository,
    pendingOperation,
  });
  const resetDisabledReason = !activeProjectPath
    ? "Open a folder before resetting history."
    : !hasGitRepository
      ? "Open a Git repository before resetting history."
      : gitWriteOperationPendingTitle(pendingOperation);
  const historyOperationDisabledReason = !activeProjectPath
    ? "Open a folder before editing history."
    : !hasGitRepository
      ? "Open a Git repository before editing history."
      : gitWriteOperationPendingTitle(pendingOperation);
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
    setHistoryOperationError(null);
    setPushError(null);
    setResetError(null);
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
    setHistoryOperationError(null);
    setPushError(null);
    setResetError(null);
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

  const publishCurrentBranchToRemote = useCallback(async (): Promise<boolean> => {
    if (!activeProjectPath || !currentBranch?.current || currentBranch.branchType !== "local") {
      const message = "Checkout a local branch before publishing.";
      setPushError(message);
      await showNativeMessage(message, { kind: "warning" });
      return false;
    }
    const pendingReason = gitWriteOperationPendingTitle(pendingOperation);
    if (pendingReason) {
      setPushError(pendingReason);
      await showNativeMessage(pendingReason, { kind: "warning" });
      return false;
    }
    const remote = window.prompt("Publish to remote", defaultRemoteName);
    if (remote === null) {
      return false;
    }
    const remoteBranch = window.prompt("Remote branch", currentBranch.name);
    if (remoteBranch === null) {
      return false;
    }
    const normalizedRemote = remote.trim();
    const normalizedBranch = remoteBranch.trim();
    if (!normalizedRemote || !normalizedBranch) {
      const message = "Enter a remote and branch before publishing.";
      setPushError(message);
      await showNativeMessage(message, { kind: "warning" });
      return false;
    }
    const confirmed = await confirmNativeDialog(
      publishBranchLabel(currentBranch.name, normalizedRemote, normalizedBranch),
      {
        cancelLabel: "Cancel",
        kind: "info",
        okLabel: "Publish",
      },
    );
    if (!confirmed) {
      return false;
    }

    const operation = {
      kind: "push",
      scope: "repository",
    } satisfies GitWriteOperation;
    if (!beginGitWrite(operation)) {
      return false;
    }

    setCommitError(null);
    setHistoryOperationError(null);
    setPushError(null);
    setResetError(null);
    let shouldRefresh = false;

    try {
      shouldRefresh = true;
      await pushCurrentBranch(activeProjectPath, {
        remote: normalizedRemote,
        branch: normalizedBranch,
        setUpstream: true,
      });
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
    currentBranch,
    defaultRemoteName,
    endGitWrite,
    pendingOperation,
    refreshProjectFileState,
  ]);

  const forcePushCurrentBranchWithLease = useCallback(async (): Promise<boolean> => {
    if (!activeProjectPath || !currentBranch?.current || currentBranch.branchType !== "local") {
      const message = "Checkout a local branch before force pushing.";
      setPushError(message);
      await showNativeMessage(message, { kind: "warning" });
      return false;
    }
    if (!currentBranch.upstream) {
      const message = "Configure an upstream before force pushing.";
      setPushError(message);
      await showNativeMessage(message, { kind: "warning" });
      return false;
    }
    const pendingReason = gitWriteOperationPendingTitle(pendingOperation);
    if (pendingReason) {
      setPushError(pendingReason);
      await showNativeMessage(pendingReason, { kind: "warning" });
      return false;
    }
    const confirmed = await confirmNativeDialog(
      forceWithLeaseConfirmation(currentBranch.name, currentBranch.upstream),
      {
        cancelLabel: "Cancel",
        kind: "warning",
        okLabel: "Force with lease",
      },
    );
    if (!confirmed) {
      return false;
    }

    const operation = {
      kind: "push",
      scope: "repository",
    } satisfies GitWriteOperation;
    if (!beginGitWrite(operation)) {
      return false;
    }

    setCommitError(null);
    setHistoryOperationError(null);
    setPushError(null);
    setResetError(null);
    let shouldRefresh = false;

    try {
      shouldRefresh = true;
      await pushCurrentBranch(activeProjectPath, { forceWithLease: true });
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
    currentBranch,
    endGitWrite,
    pendingOperation,
    refreshProjectFileState,
  ]);

  const resetHardToReflogEntry = useCallback(async (
    selector: string,
  ): Promise<boolean> => {
    if (resetDisabledReason) {
      setResetError(resetDisabledReason);
      await showNativeMessage(resetDisabledReason, { kind: "warning" });
      return false;
    }

    const normalizedSelector = selector.trim();
    if (!normalizedSelector) {
      const message = "Choose a reflog entry before resetting history.";
      setResetError(message);
      await showNativeMessage(message, { kind: "warning" });
      return false;
    }

    const operation = {
      kind: "reset",
      scope: "repository",
    } satisfies GitWriteOperation;
    if (!activeProjectPath || !beginGitWrite(operation)) {
      return false;
    }

    setCommitError(null);
    setHistoryOperationError(null);
    setPushError(null);
    setResetError(null);
    let shouldRefresh = false;

    try {
      const confirmed = await confirmNativeDialog(
        `Restore the current branch to ${normalizedSelector}?\n\nThis runs git reset --hard ${normalizedSelector}.\n\nTracked staged and unstaged changes will be discarded. Untracked files are left as-is.`,
        {
          cancelLabel: "Cancel",
          kind: "warning",
          okLabel: "Reset --hard",
        },
      );
      if (!confirmed) {
        return false;
      }

      shouldRefresh = true;
      await resetHardToReflog({
        path: activeProjectPath,
        selector: normalizedSelector,
      });
      return true;
    } catch (error) {
      const message = errorMessage(error);
      setResetError(message);
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
    refreshProjectFileState,
    resetDisabledReason,
  ]);

  const runHistoryCommitAction = useCallback(
    async (
      kind: "cherryPick" | "revert",
      commit: string,
      command: (request: {
        readonly path: string;
        readonly commit: string;
      }) => Promise<unknown>,
      confirmMessage: (commitLabel: string) => string,
      okLabel: string,
    ): Promise<boolean> => {
      if (historyOperationDisabledReason) {
        setHistoryOperationError(historyOperationDisabledReason);
        await showNativeMessage(historyOperationDisabledReason, {
          kind: "warning",
        });
        return false;
      }

      const normalizedCommit = commit.trim();
      if (!normalizedCommit) {
        const message = "Choose a commit before editing history.";
        setHistoryOperationError(message);
        await showNativeMessage(message, { kind: "warning" });
        return false;
      }

      const operation = {
        kind,
        scope: "repository",
      } satisfies GitWriteOperation;
      if (!activeProjectPath || !beginGitWrite(operation)) {
        return false;
      }

      setCommitError(null);
      setGitOperationError(null);
      setHistoryOperationError(null);
      setPushError(null);
      setResetError(null);
      let shouldRefresh = false;

      try {
        const commitLabel = shortCommitLabel(normalizedCommit);
        const confirmed = await confirmNativeDialog(confirmMessage(commitLabel), {
          cancelLabel: "Cancel",
          kind: "warning",
          okLabel,
        });
        if (!confirmed) {
          return false;
        }

        shouldRefresh = true;
        await command({
          path: activeProjectPath,
          commit: normalizedCommit,
        });
        return true;
      } catch (error) {
        const message = errorMessage(error);
        setHistoryOperationError(message);
        await showNativeMessage(message, { kind: "error" });
        return false;
      } finally {
        if (shouldRefresh) {
          await refreshProjectFileState(activeProjectPath);
        }
        endGitWrite(operation);
      }
    },
    [
      activeProjectPath,
      beginGitWrite,
      endGitWrite,
      historyOperationDisabledReason,
      refreshProjectFileState,
    ],
  );

  const cherryPickHistoryCommit = useCallback(
    (hash: string) =>
      runHistoryCommitAction(
        "cherryPick",
        hash,
        cherryPickCommit,
        (commitLabel) =>
          `Cherry-pick ${commitLabel} onto the current branch?\n\nThis applies the selected commit. If it conflicts, resolve the files and use Continue or Abort.`,
        "Cherry-pick",
      ),
    [runHistoryCommitAction],
  );

  const revertHistoryCommit = useCallback(
    (hash: string) =>
      runHistoryCommitAction(
        "revert",
        hash,
        revertCommit,
        (commitLabel) =>
          `Revert ${commitLabel} on the current branch?\n\nThis creates a new commit that undoes the selected commit. If it conflicts, resolve the files and use Continue or Abort.`,
        "Revert",
      ),
    [runHistoryCommitAction],
  );

  const runGitOperationAction = useCallback(
    async (
      kind: "abort" | "continue" | "skip",
      command: (projectPath: string) => Promise<unknown>,
      confirmMessage: string | null,
    ): Promise<boolean> => {
      if (!activeProjectPath) {
        return false;
      }
      const state = gitOperationState;
      if (!state) {
        const message = "No merge, rebase, cherry-pick, or revert is in progress.";
        setGitOperationError(message);
        await showNativeMessage(message, { kind: "warning" });
        return false;
      }
      if (kind === "skip" && !state.canSkip) {
        const message = "This Git operation does not support skip.";
        setGitOperationError(message);
        await showNativeMessage(message, { kind: "warning" });
        return false;
      }
      const operation = {
        kind,
        scope: "repository",
      } satisfies GitWriteOperation;
      if (!beginGitWrite(operation)) {
        return false;
      }

      setCommitError(null);
      setGitOperationError(null);
      setHistoryOperationError(null);
      setPushError(null);
      setResetError(null);
      let shouldRefresh = false;

      try {
        if (confirmMessage) {
          const confirmed = await confirmNativeDialog(confirmMessage, {
            cancelLabel: "Cancel",
            kind: "warning",
            okLabel: operationButtonLabel(kind),
          });
          if (!confirmed) {
            return false;
          }
        }

        shouldRefresh = true;
        await command(activeProjectPath);
        return true;
      } catch (error) {
        const message = errorMessage(error);
        setGitOperationError(message);
        await showNativeMessage(message, { kind: "error" });
        return false;
      } finally {
        if (shouldRefresh) {
          await refreshProjectFileState(activeProjectPath);
        }
        endGitWrite(operation);
      }
    },
    [
      activeProjectPath,
      beginGitWrite,
      endGitWrite,
      gitOperationState,
      refreshProjectFileState,
    ],
  );

  const continueGitOperationInProgress = useCallback(
    () =>
      runGitOperationAction(
        "continue",
        continueGitOperation,
        null,
      ),
    [runGitOperationAction],
  );

  const abortGitOperationInProgress = useCallback(
    () =>
      runGitOperationAction(
        "abort",
        abortGitOperation,
        `Abort the in-progress ${gitOperationLabel(gitOperationState?.kind)}?`,
      ),
    [gitOperationState?.kind, runGitOperationAction],
  );

  const skipGitOperationInProgress = useCallback(
    () =>
      runGitOperationAction(
        "skip",
        skipGitOperation,
        `Skip the current ${gitOperationLabel(gitOperationState?.kind)} step?`,
      ),
    [gitOperationState?.kind, runGitOperationAction],
  );

  return {
    abortGitOperationInProgress,
    canCommit: commitDisabledReason === null,
    canPush: pushDisabledReason === null,
    cherryPickHistoryCommit,
    commitDisabledReason,
    commitError,
    commitMessageHint,
    commitMessage,
    commitPending: pendingGitWriteAction === "commit",
    commitStagedChanges,
    commitWarning,
    conflictCount,
    currentBranch,
    dirtyDraftCount,
    continueGitOperationInProgress,
    forcePushCurrentBranchWithLease,
    gitOperationError,
    gitOperationPending:
      pendingGitWriteAction === "abort" ||
      pendingGitWriteAction === "continue" ||
      pendingGitWriteAction === "skip",
    gitOperationState,
    gitWritePendingReason,
    historyOperationDisabledReason,
    historyOperationError,
    historyOperationPending:
      pendingGitWriteAction === "cherryPick" ||
      pendingGitWriteAction === "revert",
    pendingGitWriteAction,
    publishCurrentBranchToRemote,
    pushCurrentBranchToUpstream,
    pushDisabledReason,
    pushError,
    pushPending: pendingGitWriteAction === "push",
    resetDisabledReason,
    resetError,
    resetHardToReflogEntry,
    resetPending: pendingGitWriteAction === "reset",
    revertHistoryCommit,
    setCommitMessage,
    skipGitOperationInProgress,
    stagedCount,
  };
}

function requireActiveProjectPath(path: string | null): string {
  if (!path) {
    throw new Error("Open a repository before inspecting Git operation state.");
  }

  return path;
}

function gitOperationLabel(kind: GitOperationState["kind"] | undefined): string {
  switch (kind) {
    case "cherryPick":
      return "cherry-pick";
    case "merge":
      return "merge";
    case "rebase":
      return "rebase";
    case "revert":
      return "revert";
    default:
      return "Git operation";
  }
}

function operationButtonLabel(kind: "abort" | "continue" | "skip"): string {
  switch (kind) {
    case "abort":
      return "Abort";
    case "continue":
      return "Continue";
    case "skip":
      return "Skip";
  }
}

function shortCommitLabel(hash: string): string {
  return hash.length > 12 ? hash.slice(0, 12) : hash;
}

function defaultRemoteForBranch(
  branch: BranchInfo | null,
  payload: RepositoryPayload | undefined,
): string {
  const upstreamRemote = branch?.upstream
    ?.replace(/^refs\/remotes\//, "")
    .split("/")[0];
  if (upstreamRemote) {
    return upstreamRemote;
  }
  for (const candidate of payload?.summary.branches ?? []) {
    if (candidate.branchType !== "remote") {
      continue;
    }
    const [remote] = candidate.name.split("/");
    if (remote) {
      return remote;
    }
  }
  return "origin";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
