import type { ContextMenuOpenContext } from "@pierre/trees";
import { Minus, Plus, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import type { TreeFile } from "../lib/api";
import {
  stageableFilePaths,
  unstageableFilePaths,
} from "../lib/gitBatchFileActions";

export type TreeGitFileActionKind = "restore" | "stage" | "unstage";

export interface TreeGitFileActions {
  readonly canRun: boolean;
  readonly pendingKind: TreeGitFileActionKind | null;
  readonly pendingPath: string | null;
  readonly pendingTitle: string | null;
  readonly onRestoreFile?: (path: string) => void;
  readonly onStageFile?: (path: string) => void;
  readonly onStageFiles?: (paths: readonly string[]) => void;
  readonly onUnstageFile?: (path: string) => void;
  readonly onUnstageFiles?: (paths: readonly string[]) => void;
}

export interface TreeGitContextMenuAction {
  readonly disabled: boolean;
  readonly icon: ReactNode;
  readonly key: TreeGitFileActionKind;
  readonly label: string;
  readonly title: string;
  readonly onSelect: () => void;
}

export function buildGitContextMenuActions(
  files: readonly TreeFile[],
  gitFileActions: TreeGitFileActions | undefined,
  context: ContextMenuOpenContext,
): TreeGitContextMenuAction[] {
  if (files.length === 0 || !gitFileActions) {
    return [];
  }

  if (files.length > 1) {
    return buildBatchGitContextMenuActions(files, gitFileActions, context);
  }

  const file = files[0];
  if (!file) {
    return [];
  }

  const pendingTitle = pendingGitActionTitle(gitFileActions);
  const conflict = file.conflict === true;
  const actions: TreeGitContextMenuAction[] = [];

  if (hasStageableWorktreeChange(file) && gitFileActions.onStageFile) {
    actions.push({
      disabled: conflict || !gitFileActions.canRun,
      icon: <Plus size={13} />,
      key: "stage",
      label: "Stage",
      title:
        pendingTitle ??
        (conflict
          ? "Resolve the conflict before staging this file."
          : "Stage this file"),
      onSelect: () => {
        context.close();
        gitFileActions.onStageFile?.(file.path);
      },
    });
  }

  if (file.staged === true && gitFileActions.onUnstageFile) {
    actions.push({
      disabled: conflict || !gitFileActions.canRun,
      icon: <Minus size={13} />,
      key: "unstage",
      label: "Unstage",
      title:
        pendingTitle ??
        (conflict
          ? "Resolve the conflict before unstaging this file."
          : "Unstage this file"),
      onSelect: () => {
        context.close();
        gitFileActions.onUnstageFile?.(file.path);
      },
    });
  }

  if (
    (hasRestorableWorktreeChange(file) || conflict) &&
    gitFileActions.onRestoreFile
  ) {
    actions.push({
      disabled: conflict || !gitFileActions.canRun,
      icon: <RotateCcw size={13} />,
      key: "restore",
      label: "Restore/Discard",
      title:
        pendingTitle ??
        (conflict
          ? "Resolve the conflict before discarding changes."
          : "Discard worktree changes in this file"),
      onSelect: () => {
        context.close();
        gitFileActions.onRestoreFile?.(file.path);
      },
    });
  }

  return actions;
}

function buildBatchGitContextMenuActions(
  files: readonly TreeFile[],
  gitFileActions: TreeGitFileActions,
  context: ContextMenuOpenContext,
): TreeGitContextMenuAction[] {
  const pendingTitle = pendingGitActionTitle(gitFileActions);
  const stageablePaths = stageableFilePaths(files);
  const unstageablePaths = unstageableFilePaths(files);
  const actions: TreeGitContextMenuAction[] = [];

  if (stageablePaths.length > 0 && gitFileActions.onStageFiles) {
    actions.push({
      disabled: !gitFileActions.canRun,
      icon: <Plus size={13} />,
      key: "stage",
      label: "Stage selected",
      title:
        pendingTitle ??
        `Stage ${stageablePaths.length} selected file${stageablePaths.length === 1 ? "" : "s"}`,
      onSelect: () => {
        context.close();
        gitFileActions.onStageFiles?.(stageablePaths);
      },
    });
  }

  if (unstageablePaths.length > 0 && gitFileActions.onUnstageFiles) {
    actions.push({
      disabled: !gitFileActions.canRun,
      icon: <Minus size={13} />,
      key: "unstage",
      label: "Unstage selected",
      title:
        pendingTitle ??
        `Unstage ${unstageablePaths.length} selected file${unstageablePaths.length === 1 ? "" : "s"}`,
      onSelect: () => {
        context.close();
        gitFileActions.onUnstageFiles?.(unstageablePaths);
      },
    });
  }

  return actions;
}

function hasStageableWorktreeChange(file: TreeFile): boolean {
  return (
    file.unstaged === true ||
    file.untracked === true ||
    (file.deleted === true && file.worktreeStatus === "D")
  );
}

function hasRestorableWorktreeChange(file: TreeFile): boolean {
  return file.unstaged === true || file.untracked === true;
}

function pendingGitActionTitle(
  gitFileActions: TreeGitFileActions,
): string | null {
  if (gitFileActions.canRun) {
    return null;
  }

  if (gitFileActions.pendingTitle) {
    return gitFileActions.pendingTitle;
  }

  if (gitFileActions.pendingPath) {
    return `A Git ${gitFileActions.pendingKind ?? "file"} action is already running for ${gitFileActions.pendingPath}.`;
  }

  return "A Git write action is already running.";
}
