import type {
  ContextMenuItem,
  ContextMenuOpenContext,
} from "@pierre/trees";
import {
  FilePlus2,
  Minus,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
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
interface TreeContextMenuProps {
  readonly context: ContextMenuOpenContext;
  readonly file: TreeFile | null;
  readonly gitFileActions?: TreeGitFileActions;
  readonly item: ContextMenuItem;
  readonly onCreateFile?: (parentPath: string | null) => void;
  readonly onDeleteFile?: (path: string) => void;
  readonly onStartRename?: (path: string) => void;
  readonly onRunScript?: () => void;
}

interface GitContextMenuAction {
  readonly disabled: boolean;
  readonly icon: ReactNode;
  readonly key: TreeGitFileActionKind;
  readonly label: string;
  readonly title: string;
  readonly onSelect: () => void;
}

interface TreeContextMenuActionOptions {
  readonly canStartRename?: boolean;
  readonly gitFileActions?: TreeGitFileActions;
  readonly onCreateFile?: (parentPath: string | null) => void;
  readonly onDeleteFile?: (path: string) => void;
  readonly onRunScript?: () => void;
}

// Pure helper co-located with the component for its callers; Fast Refresh is
// not a concern for this non-component export.
// oxlint-disable-next-line react-doctor/only-export-components
export function hasTreeContextMenuActions({
  canStartRename = false,
  gitFileActions,
  onCreateFile,
  onDeleteFile,
  onRunScript,
}: TreeContextMenuActionOptions): boolean {
  return Boolean(
    onCreateFile ||
      onDeleteFile ||
      canStartRename ||
      onRunScript ||
      gitFileActions?.onRestoreFile ||
      gitFileActions?.onStageFile ||
      gitFileActions?.onUnstageFile,
  );
}

export function TreeContextMenu({
  context,
  file,
  gitFileActions,
  item,
  onCreateFile,
  onDeleteFile,
  onStartRename,
  onRunScript,
}: TreeContextMenuProps) {
  const parentPath =
    item.kind === "directory" ? item.path : parentPathFromTreePath(item.path);
  const gitActions = buildGitContextMenuActions(file, gitFileActions, context);
  const hasFileActions = Boolean(onCreateFile || onStartRename || onDeleteFile);

  if (!hasFileActions && gitActions.length === 0 && !onRunScript) {
    return null;
  }

  return (
    <div
      className="tree-context-menu"
      data-file-tree-context-menu-root="true"
      role="menu"
    >
      {gitActions.map((action) => (
        <button
          key={action.key}
          role="menuitem"
          type="button"
          disabled={action.disabled}
          title={action.title}
          onClick={action.onSelect}
        >
          {action.icon}
          {action.label}
        </button>
      ))}
      {onRunScript ? (
        <button
          role="menuitem"
          type="button"
          onClick={() => {
            context.close();
            onRunScript();
          }}
        >
          <Play size={13} />
          Run…
        </button>
      ) : null}
      {onCreateFile ? (
        <button
          role="menuitem"
          type="button"
          onClick={() => {
            context.close();
            onCreateFile(parentPath);
          }}
        >
          <FilePlus2 size={13} />
          New file
        </button>
      ) : null}
      {onStartRename ? (
        <button
          role="menuitem"
          type="button"
          disabled={item.kind === "directory"}
          onClick={() => onStartRename(item.path)}
        >
          <Pencil size={13} />
          Rename
        </button>
      ) : null}
      {onDeleteFile ? (
        <button
          role="menuitem"
          type="button"
          disabled={item.kind === "directory"}
          onClick={() => {
            context.close();
            onDeleteFile(item.path);
          }}
        >
          <Trash2 size={13} />
          Delete
        </button>
      ) : null}
      <button role="menuitem" type="button" onClick={() => context.close()}>
        <X size={13} />
        Close
      </button>
    </div>
  );
}

function buildGitContextMenuActions(
  file: TreeFile | null,
  gitFileActions: TreeGitFileActions | undefined,
  context: ContextMenuOpenContext,
): GitContextMenuAction[] {
  if (!file || !gitFileActions) {
    return [];
  }

  const pendingTitle = pendingGitActionTitle(gitFileActions);
  const conflict = file.conflict === true;
  const actions: GitContextMenuAction[] = [];

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

function parentPathFromTreePath(path: string): string | null {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return null;
  }
  return `${parts.slice(0, -1).join("/")}/`;
}
