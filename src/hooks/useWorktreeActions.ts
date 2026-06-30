import { useCallback, useMemo, useState } from "react";
import type {
  BranchInfo,
  RepositoryPayload,
  WorktreeInfo,
} from "../lib/api";
import {
  createWorktree,
  isTauriRuntime,
  pruneWorktrees,
  removeWorktree,
} from "../lib/api";
import {
  defaultWorktreeBranchName,
  defaultWorktreeFolderName,
  isSameWorktreePath,
  worktreePathLabel,
} from "../lib/worktreeActions";
import { confirmNativeDialog, showNativeMessage } from "../lib/nativeDialogs";
import type { SavedProject } from "../lib/projects";

export type WorktreeActionKind = "create" | "remove" | "prune";

export interface WorktreeActionPending {
  readonly kind: WorktreeActionKind;
  readonly path: string | null;
}

export interface WorktreeActions {
  readonly pending: WorktreeActionPending | null;
  readonly createFromBranch: (branch: BranchInfo | null) => Promise<void>;
  readonly prune: () => Promise<void>;
  readonly remove: (worktree: WorktreeInfo) => Promise<void>;
  readonly switchTo: (worktree: WorktreeInfo) => void;
}

export interface UseWorktreeActionsOptions {
  readonly activeProject: SavedProject | undefined;
  readonly hasGitRepository: boolean;
  readonly repositoryPayload: RepositoryPayload | undefined;
  readonly refreshProjectFileState: (projectPath: string) => Promise<void>;
  readonly selectProjectPath: (
    rootPath: string,
    activePath: string,
    action: string,
  ) => boolean;
}

export function useWorktreeActions({
  activeProject,
  hasGitRepository,
  repositoryPayload,
  refreshProjectFileState,
  selectProjectPath,
}: UseWorktreeActionsOptions): WorktreeActions {
  const [pending, setPending] = useState<WorktreeActionPending | null>(null);
  const repositoryRootPath = useMemo(
    () =>
      repositoryPayload?.summary.worktrees[0]?.path ??
      repositoryPayload?.summary.root ??
      activeProject?.rootPath ??
      null,
    [activeProject?.rootPath, repositoryPayload],
  );

  const canRun = useCallback(
    () =>
      Boolean(activeProject && repositoryRootPath && hasGitRepository && isTauriRuntime()),
    [activeProject, hasGitRepository, repositoryRootPath],
  );

  const switchTo = useCallback(
    (worktree: WorktreeInfo) => {
      if (!activeProject || !repositoryRootPath || !hasGitRepository) {
        return;
      }
      if (isSameWorktreePath(activeProject.activePath, worktree.path)) {
        return;
      }

      selectProjectPath(
        repositoryRootPath,
        worktree.path,
        `switch to ${worktreePathLabel(worktree.path)}`,
      );
    },
    [activeProject, hasGitRepository, repositoryRootPath, selectProjectPath],
  );

  const createFromBranch = useCallback(
    async (branch: BranchInfo | null) => {
      if (!activeProject || !repositoryRootPath || !branch || !canRun()) {
        return;
      }

      const folderName = window.prompt(
        `New worktree folder from ${branch.name}`,
        defaultWorktreeFolderName(branch),
      );
      if (!folderName?.trim()) {
        return;
      }

      const branchName = window.prompt(
        "New branch for worktree",
        defaultWorktreeBranchName(branch),
      );
      if (!branchName?.trim()) {
        return;
      }

      setPending({ kind: "create", path: null });
      try {
        const response = await createWorktree(
          activeProject.activePath,
          folderName.trim(),
          branch.refName,
          branchName.trim(),
        );
        const activePath = response.activePath;
        if (activePath) {
          selectProjectPath(
            response.summary.worktrees[0]?.path ?? repositoryRootPath,
            activePath,
            `switch to ${worktreePathLabel(activePath)}`,
          );
          return;
        }
        await refreshProjectFileState(activeProject.activePath);
      } catch (error) {
        await showNativeMessage(
          error instanceof Error ? error.message : String(error),
          { kind: "error" },
        );
        await refreshProjectFileState(activeProject.activePath);
      } finally {
        setPending(null);
      }
    },
    [
      activeProject,
      canRun,
      refreshProjectFileState,
      repositoryRootPath,
      selectProjectPath,
    ],
  );

  const remove = useCallback(
    async (worktree: WorktreeInfo) => {
      if (!activeProject || !canRun()) {
        return;
      }
      if (isSameWorktreePath(activeProject.activePath, worktree.path)) {
        await showNativeMessage("Cannot remove the active worktree.", {
          kind: "warning",
        });
        return;
      }

      const label = worktree.branch ?? worktreePathLabel(worktree.path);
      if (
        !(await confirmNativeDialog(`Remove worktree ${label}?`, {
          cancelLabel: "Cancel",
          kind: "warning",
          okLabel: "Remove",
        }))
      ) {
        return;
      }

      setPending({ kind: "remove", path: worktree.path });
      try {
        try {
          await removeWorktree(activeProject.activePath, worktree.path, false);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (
            !(await confirmNativeDialog(`${message}\n\nForce remove ${label}?`, {
              cancelLabel: "Cancel",
              kind: "warning",
              okLabel: "Force Remove",
            }))
          ) {
            return;
          }
          await removeWorktree(activeProject.activePath, worktree.path, true);
        }
        await refreshProjectFileState(activeProject.activePath);
      } catch (error) {
        await showNativeMessage(
          error instanceof Error ? error.message : String(error),
          { kind: "error" },
        );
        await refreshProjectFileState(activeProject.activePath);
      } finally {
        setPending(null);
      }
    },
    [activeProject, canRun, refreshProjectFileState],
  );

  const prune = useCallback(async () => {
    if (!activeProject || !canRun()) {
      return;
    }

    setPending({ kind: "prune", path: null });
    try {
      await pruneWorktrees(activeProject.activePath);
      await refreshProjectFileState(activeProject.activePath);
    } catch (error) {
      await showNativeMessage(
        error instanceof Error ? error.message : String(error),
        { kind: "error" },
      );
      await refreshProjectFileState(activeProject.activePath);
    } finally {
      setPending(null);
    }
  }, [activeProject, canRun, refreshProjectFileState]);

  return {
    pending,
    createFromBranch,
    prune,
    remove,
    switchTo,
  };
}
