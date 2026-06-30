import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyStash,
  createStash,
  dropStash,
  getStashDiff,
  isTauriRuntime,
  listStashes,
  popStash,
  type RepositoryPayload,
  type StashEntry,
  type TreeFile,
} from "../lib/api";
import { defaultStashMessage } from "../lib/stashActions";
import { confirmNativeDialog, showNativeMessage } from "../lib/nativeDialogs";
import type { SavedProject } from "../lib/projects";
import {
  gitWriteOperationPendingTitle,
  type GitWriteGuard,
  type GitWriteOperation,
} from "./useGitWriteGuard";

export type StashActionKind = "create" | "apply" | "pop" | "drop";

export interface StashActionPending {
  readonly kind: StashActionKind;
  readonly selector: string | null;
}

export interface StashActions {
  readonly entries: readonly StashEntry[];
  readonly error: string | null;
  readonly loading: boolean;
  readonly pending: StashActionPending | null;
  readonly pendingTitle: string | null;
  readonly selectedDiff: string | null;
  readonly selectedDiffLoading: boolean;
  readonly selectedSelector: string | null;
  readonly apply: (entry: StashEntry) => Promise<void>;
  readonly create: () => Promise<void>;
  readonly drop: (entry: StashEntry) => Promise<void>;
  readonly pop: (entry: StashEntry) => Promise<void>;
  readonly select: (entry: StashEntry) => void;
}

export interface UseStashActionsOptions {
  readonly activeProject: SavedProject | undefined;
  readonly gitWriteGuard: GitWriteGuard;
  readonly hasGitRepository: boolean;
  readonly repositoryPayload: RepositoryPayload | undefined;
  readonly refreshProjectFileState: (projectPath: string) => Promise<void>;
  readonly worktreeFiles: readonly TreeFile[];
}

export function useStashActions({
  activeProject,
  gitWriteGuard,
  hasGitRepository,
  repositoryPayload,
  refreshProjectFileState,
  worktreeFiles,
}: UseStashActionsOptions): StashActions {
  const queryClient = useQueryClient();
  const activeProjectPath = activeProject?.activePath ?? null;
  const [selectedSelector, setSelectedSelector] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<StashActionPending | null>(null);
  const { beginGitWrite, endGitWrite, pendingOperation } = gitWriteGuard;
  const repositoryPendingReason = gitWriteOperationPendingTitle(pendingOperation);
  const enabled = Boolean(activeProjectPath && hasGitRepository);

  const stashesQuery = useQuery({
    queryKey: ["stashes", activeProjectPath],
    queryFn: () => listStashes(requireActiveProjectPath(activeProjectPath)),
    enabled,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const entries = stashesQuery.data?.entries ?? [];
  const selectedEntry = useMemo(
    () =>
      selectedSelector
        ? entries.find((entry) => entry.selector === selectedSelector) ?? null
        : null,
    [entries, selectedSelector],
  );
  const diffQuery = useQuery({
    queryKey: ["stash-diff", activeProjectPath, selectedSelector],
    queryFn: () =>
      getStashDiff(
        requireActiveProjectPath(activeProjectPath),
        requireSelectedStash(selectedSelector),
      ),
    enabled: enabled && selectedEntry !== null,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const currentBranchName =
    repositoryPayload?.summary.branches.find((branch) => branch.current)?.name ??
    repositoryPayload?.summary.branch ??
    null;
  const trackedCount = useMemo(
    () => worktreeFiles.filter((file) => !file.untracked).length,
    [worktreeFiles],
  );
  const untrackedCount = useMemo(
    () => worktreeFiles.filter((file) => file.untracked).length,
    [worktreeFiles],
  );

  useEffect(() => {
    if (!selectedSelector) {
      return;
    }
    if (!entries.some((entry) => entry.selector === selectedSelector)) {
      setSelectedSelector(null);
    }
  }, [entries, selectedSelector]);

  const refreshStashState = useCallback(
    async (projectPath: string) => {
      await Promise.all([
        refreshProjectFileState(projectPath),
        queryClient.invalidateQueries({ queryKey: ["stashes", projectPath] }),
        queryClient.resetQueries({ queryKey: ["stash-diff", projectPath] }),
      ]);
    },
    [queryClient, refreshProjectFileState],
  );

  const runStashMutation = useCallback(
    async (
      kind: StashActionKind,
      selector: string | null,
      operation: () => Promise<void>,
    ) => {
      if (!activeProjectPath || !isTauriRuntime()) {
        return;
      }

      const gitOperation = {
        kind: "stash",
        scope: "repository",
      } satisfies GitWriteOperation;
      if (!beginGitWrite(gitOperation)) {
        return;
      }

      setPending({ kind, selector });
      setError(null);
      try {
        await operation();
        await refreshStashState(activeProjectPath);
      } catch (caught) {
        const message = errorMessage(caught);
        setError(message);
        await showNativeMessage(message, { kind: "error" });
        await refreshStashState(activeProjectPath);
      } finally {
        setPending(null);
        endGitWrite(gitOperation);
      }
    },
    [activeProjectPath, beginGitWrite, endGitWrite, refreshStashState],
  );

  const create = useCallback(async () => {
    if (!activeProjectPath || !hasGitRepository) {
      return;
    }

    const message = window.prompt(
      "Stash message",
      defaultStashMessage(currentBranchName, trackedCount, untrackedCount),
    );
    if (message === null) {
      return;
    }

    await runStashMutation("create", null, async () => {
      await createStash({
        path: activeProjectPath,
        message,
        includeUntracked: true,
      });
    });
  }, [
    activeProjectPath,
    currentBranchName,
    hasGitRepository,
    runStashMutation,
    trackedCount,
    untrackedCount,
  ]);

  const apply = useCallback(
    async (entry: StashEntry) => {
      if (!activeProjectPath) {
        return;
      }

      await runStashMutation("apply", entry.selector, async () => {
        await applyStash({
          path: activeProjectPath,
          selector: entry.selector,
        });
      });
    },
    [activeProjectPath, runStashMutation],
  );

  const pop = useCallback(
    async (entry: StashEntry) => {
      if (!activeProjectPath) {
        return;
      }
      if (
        !(await confirmNativeDialog(`Pop ${entry.selector}?`, {
          cancelLabel: "Cancel",
          kind: "warning",
          okLabel: "Pop",
        }))
      ) {
        return;
      }

      await runStashMutation("pop", entry.selector, async () => {
        await popStash({
          path: activeProjectPath,
          selector: entry.selector,
        });
      });
    },
    [activeProjectPath, runStashMutation],
  );

  const drop = useCallback(
    async (entry: StashEntry) => {
      if (!activeProjectPath) {
        return;
      }
      if (
        !(await confirmNativeDialog(`Drop ${entry.selector}?`, {
          cancelLabel: "Cancel",
          kind: "warning",
          okLabel: "Drop",
        }))
      ) {
        return;
      }

      await runStashMutation("drop", entry.selector, async () => {
        await dropStash({
          path: activeProjectPath,
          selector: entry.selector,
        });
      });
    },
    [activeProjectPath, runStashMutation],
  );

  const select = useCallback((entry: StashEntry) => {
    setSelectedSelector((current) =>
      current === entry.selector ? null : entry.selector,
    );
  }, []);

  return {
    entries,
    error,
    loading: stashesQuery.isLoading,
    pending,
    pendingTitle: repositoryPendingReason,
    selectedDiff: diffQuery.data ?? null,
    selectedDiffLoading: diffQuery.isLoading || diffQuery.isFetching,
    selectedSelector,
    apply,
    create,
    drop,
    pop,
    select,
  };
}

function requireActiveProjectPath(path: string | null): string {
  if (!path) {
    throw new Error("Open a repository before using stash.");
  }

  return path;
}

function requireSelectedStash(selector: string | null): string {
  if (!selector) {
    throw new Error("Choose a stash entry first.");
  }

  return selector;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
