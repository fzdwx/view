import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import {
  addRemote,
  isTauriRuntime,
  listRemotes,
  removeRemote,
  renameRemote,
  type RemoteInfo,
} from "../lib/api";
import {
  normalizeRemoteName,
  remoteActionDisabledReason,
} from "../lib/remoteActions";
import { confirmNativeDialog, showNativeMessage } from "../lib/nativeDialogs";
import type { SavedProject } from "../lib/projects";
import {
  gitWriteOperationPendingTitle,
  type GitWriteGuard,
  type GitWriteOperation,
} from "./useGitWriteGuard";

export type RemoteActionKind = "add" | "rename" | "remove";

export interface RemoteActionPending {
  readonly kind: RemoteActionKind;
  readonly name: string | null;
}

export interface RemoteActions {
  readonly error: string | null;
  readonly loading: boolean;
  readonly pending: RemoteActionPending | null;
  readonly pendingTitle: string | null;
  readonly remotes: readonly RemoteInfo[];
  readonly add: () => Promise<void>;
  readonly rename: (remote: RemoteInfo) => Promise<void>;
  readonly remove: (remote: RemoteInfo) => Promise<void>;
}

export interface UseRemoteActionsOptions {
  readonly activeProject: SavedProject | undefined;
  readonly gitWriteGuard: GitWriteGuard;
  readonly hasGitRepository: boolean;
  readonly refreshProjectFileState: (projectPath: string) => Promise<void>;
}

export function useRemoteActions({
  activeProject,
  gitWriteGuard,
  hasGitRepository,
  refreshProjectFileState,
}: UseRemoteActionsOptions): RemoteActions {
  const queryClient = useQueryClient();
  const activeProjectPath = activeProject?.activePath ?? null;
  const [pending, setPending] = useState<RemoteActionPending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { beginGitWrite, endGitWrite, pendingOperation } = gitWriteGuard;
  const repositoryPendingReason = gitWriteOperationPendingTitle(pendingOperation);
  const enabled = Boolean(activeProjectPath && hasGitRepository && isTauriRuntime());
  const remotesQuery = useQuery({
    queryKey: ["git-remotes", activeProjectPath],
    queryFn: () => listRemotes(requireActiveProjectPath(activeProjectPath)),
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const refreshRemoteState = useCallback(
    async (projectPath: string) => {
      await Promise.all([
        refreshProjectFileState(projectPath),
        queryClient.invalidateQueries({ queryKey: ["git-remotes", projectPath] }),
      ]);
    },
    [queryClient, refreshProjectFileState],
  );

  const runRemoteMutation = useCallback(
    async (
      kind: RemoteActionKind,
      name: string | null,
      operation: () => Promise<void>,
    ) => {
      if (!activeProjectPath || !isTauriRuntime()) {
        return;
      }

      const gitOperation = {
        kind: "remote",
        scope: "repository",
      } satisfies GitWriteOperation;
      if (!beginGitWrite(gitOperation)) {
        return;
      }

      setPending({ kind, name });
      setError(null);
      try {
        await operation();
        await refreshRemoteState(activeProjectPath);
      } catch (caught) {
        const message = errorMessage(caught);
        setError(message);
        await showNativeMessage(message, { kind: "error" });
        await refreshRemoteState(activeProjectPath);
      } finally {
        setPending(null);
        endGitWrite(gitOperation);
      }
    },
    [activeProjectPath, beginGitWrite, endGitWrite, refreshRemoteState],
  );

  const add = useCallback(async () => {
    const name = window.prompt("Remote name", "origin");
    if (name === null) {
      return;
    }
    const url = window.prompt("Remote URL", "");
    if (url === null) {
      return;
    }
    const disabledReason = remoteActionDisabledReason({
      activeProjectPath,
      hasGitRepository,
      name,
      pendingReason: repositoryPendingReason,
      url,
    });
    if (disabledReason) {
      setError(disabledReason);
      await showNativeMessage(disabledReason, { kind: "warning" });
      return;
    }

    const remoteName = normalizeRemoteName(name);
    await runRemoteMutation("add", remoteName, async () => {
      await addRemote({
        path: requireActiveProjectPath(activeProjectPath),
        name: remoteName,
        url: url.trim(),
      });
    });
  }, [
    activeProjectPath,
    hasGitRepository,
    repositoryPendingReason,
    runRemoteMutation,
  ]);

  const rename = useCallback(
    async (remote: RemoteInfo) => {
      const nextName = window.prompt(`Rename remote ${remote.name}`, remote.name);
      if (nextName === null || nextName.trim() === remote.name) {
        return;
      }
      const disabledReason = remoteActionDisabledReason({
        activeProjectPath,
        hasGitRepository,
        name: nextName,
        pendingReason: repositoryPendingReason,
      });
      if (disabledReason) {
        setError(disabledReason);
        await showNativeMessage(disabledReason, { kind: "warning" });
        return;
      }

      await runRemoteMutation("rename", remote.name, async () => {
        await renameRemote({
          path: requireActiveProjectPath(activeProjectPath),
          name: remote.name,
          newName: normalizeRemoteName(nextName),
        });
      });
    },
    [
      activeProjectPath,
      hasGitRepository,
      repositoryPendingReason,
      runRemoteMutation,
    ],
  );

  const remove = useCallback(
    async (remote: RemoteInfo) => {
      if (
        !(await confirmNativeDialog(`Remove remote ${remote.name}?`, {
          cancelLabel: "Cancel",
          kind: "warning",
          okLabel: "Remove",
        }))
      ) {
        return;
      }

      await runRemoteMutation("remove", remote.name, async () => {
        await removeRemote({
          path: requireActiveProjectPath(activeProjectPath),
          name: remote.name,
        });
      });
    },
    [activeProjectPath, runRemoteMutation],
  );

  return {
    error,
    loading: remotesQuery.isLoading,
    pending,
    pendingTitle: repositoryPendingReason,
    remotes: remotesQuery.data?.remotes ?? [],
    add,
    rename,
    remove,
  };
}

function requireActiveProjectPath(path: string | null): string {
  if (!path) {
    throw new Error("Open a repository before editing remotes.");
  }
  return path;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
