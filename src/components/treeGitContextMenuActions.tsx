import type { ContextMenuOpenContext } from "@pierre/trees";
import { Minus, Plus, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import type { TreeFile } from "../lib/api";

export type TreeGitFileActionKind = "restore" | "stage" | "unstage";

export interface TreeGitFileActions {
  readonly canRun: boolean;
  readonly pendingKind: TreeGitFileActionKind | null;
  readonly pendingPath: string | null;
  readonly pendingTitle: string | null;
  readonly onRestoreFile?: (path: string) => void;
  readonly onStageFile?: (path: string) => void;
  readonly onUnstageFile?: (path: string) => void;
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
  file: TreeFile | null,
  gitFileActions: TreeGitFileActions | undefined,
  context: ContextMenuOpenContext,
): TreeGitContextMenuAction[] {
  if (!file || !gitFileActions) {
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
