import type {
  ContextMenuItem,
  ContextMenuOpenContext,
} from "@pierre/trees";
import {
  Copy,
  ExternalLink,
  EyeOff,
  FilePlus2,
  FolderPlus,
  Pencil,
  Play,
  Trash2,
} from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TreeFile } from "../lib/api";
import { clamp } from "../lib/numeric";
import {
  directoryPathForNewChild,
  type ProjectTreeItemKind,
} from "../lib/projectTreeActions";
import {
  buildGitContextMenuActions,
  type TreeGitFileActions,
} from "./treeGitContextMenuActions";

export type {
  TreeGitFileActionKind,
  TreeGitFileActions,
} from "./treeGitContextMenuActions";
interface TreeContextMenuProps {
  readonly context: ContextMenuOpenContext;
  readonly files: readonly TreeFile[];
  readonly gitFileActions?: TreeGitFileActions;
  readonly item: ContextMenuItem;
  readonly onCopyRelativePath?: (path: string) => void;
  readonly onCreateDirectory?: (parentPath: string | null) => void;
  readonly onCreateFile?: (parentPath: string | null) => void;
  readonly onDeleteDirectory?: (path: string) => void;
  readonly onDeleteFile?: (path: string) => void;
  readonly onIgnorePath?: (path: string, kind: ProjectTreeItemKind) => void;
  readonly onRevealPath?: (path: string) => void;
  readonly onStartRename?: (path: string) => void;
  readonly onRunScript?: () => void;
}

interface TreeContextMenuActionOptions {
  readonly canStartRename?: boolean;
  readonly gitFileActions?: TreeGitFileActions;
  readonly onCopyRelativePath?: (path: string) => void;
  readonly onCreateDirectory?: (parentPath: string | null) => void;
  readonly onCreateFile?: (parentPath: string | null) => void;
  readonly onDeleteDirectory?: (path: string) => void;
  readonly onDeleteFile?: (path: string) => void;
  readonly onIgnorePath?: (path: string, kind: ProjectTreeItemKind) => void;
  readonly onRevealPath?: (path: string) => void;
  readonly onRunScript?: () => void;
}

interface TreeContextMenuPosition {
  readonly left: number;
  readonly top: number;
}

const treeContextMenuViewportPadding = 8;
const treeContextMenuGap = 8;
const treeContextMenuEstimatedWidth = 152;

// Pure helper co-located with the component for its callers; Fast Refresh is
// not a concern for this non-component export.
// oxlint-disable-next-line react-doctor/only-export-components
export function hasTreeContextMenuActions({
  canStartRename = false,
  gitFileActions,
  onCopyRelativePath,
  onCreateDirectory,
  onCreateFile,
  onDeleteDirectory,
  onDeleteFile,
  onIgnorePath,
  onRevealPath,
  onRunScript,
}: TreeContextMenuActionOptions): boolean {
  return Boolean(
    onCreateFile ||
      onCreateDirectory ||
      onDeleteFile ||
      onDeleteDirectory ||
      onCopyRelativePath ||
      onIgnorePath ||
      onRevealPath ||
      canStartRename ||
      onRunScript ||
      gitFileActions?.onRestoreFile ||
      gitFileActions?.onStageFile ||
      gitFileActions?.onUnstageFile,
  );
}

export function TreeContextMenu({
  context,
  files,
  gitFileActions,
  item,
  onCopyRelativePath,
  onCreateDirectory,
  onCreateFile,
  onDeleteDirectory,
  onDeleteFile,
  onIgnorePath,
  onRevealPath,
  onStartRename,
  onRunScript,
}: TreeContextMenuProps) {
  const { anchorRect } = context;
  const itemKind: ProjectTreeItemKind =
    item.kind === "directory" ? "directory" : "file";
  const parentPath =
    item.kind === "directory" ? item.path : parentPathFromTreePath(item.path);
  const newChildParentPath = directoryPathForNewChild(itemKind, item.path);
  const gitActions = buildGitContextMenuActions(files, gitFileActions, context);
  const hasProjectActions = Boolean(
    onCreateFile ||
      onCreateDirectory ||
      onStartRename ||
      onDeleteFile ||
      onDeleteDirectory ||
      onCopyRelativePath ||
      onIgnorePath ||
      onRevealPath,
  );
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPosition, setMenuPosition] = useState(() =>
    initialTreeContextMenuPosition(anchorRect),
  );

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }
    const rect = menu.getBoundingClientRect();
    const nextPosition = placeTreeContextMenu(anchorRect, {
      height: rect.height,
      width: rect.width,
    });
    setMenuPosition((previousPosition) =>
      previousPosition.left === nextPosition.left &&
      previousPosition.top === nextPosition.top
        ? previousPosition
        : nextPosition,
    );
  }, [anchorRect]);

  if (!hasProjectActions && gitActions.length === 0 && !onRunScript) {
    return null;
  }

  const menu = (
    <div
      ref={menuRef}
      className="tree-context-menu"
      data-file-tree-context-menu-root="true"
      role="menu"
      style={{
        left: `${menuPosition.left}px`,
        top: `${menuPosition.top}px`,
      }}
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
      {onCreateDirectory ? (
        <button
          role="menuitem"
          type="button"
          onClick={() => {
            context.close();
            onCreateDirectory(newChildParentPath);
          }}
        >
          <FolderPlus size={13} />
          New folder
        </button>
      ) : null}
      {onStartRename ? (
        <button
          role="menuitem"
          type="button"
          onClick={() => onStartRename(item.path)}
        >
          <Pencil size={13} />
          Rename
        </button>
      ) : null}
      {itemKind === "directory" && onDeleteDirectory ? (
        <button
          role="menuitem"
          type="button"
          onClick={() => {
            context.close();
            onDeleteDirectory(item.path);
          }}
        >
          <Trash2 size={13} />
          Delete
        </button>
      ) : null}
      {itemKind === "file" && onDeleteFile ? (
        <button
          role="menuitem"
          type="button"
          onClick={() => {
            context.close();
            onDeleteFile(item.path);
          }}
        >
          <Trash2 size={13} />
          Delete
        </button>
      ) : null}
      {onRevealPath ? (
        <button
          role="menuitem"
          type="button"
          onClick={() => {
            context.close();
            onRevealPath(item.path);
          }}
        >
          <ExternalLink size={13} />
          Reveal in OS
        </button>
      ) : null}
      {onCopyRelativePath ? (
        <button
          role="menuitem"
          type="button"
          onClick={() => {
            context.close();
            onCopyRelativePath(item.path);
          }}
        >
          <Copy size={13} />
          Copy relative path
        </button>
      ) : null}
      {onIgnorePath ? (
        <button
          role="menuitem"
          type="button"
          onClick={() => {
            context.close();
            onIgnorePath(item.path, itemKind);
          }}
        >
          <EyeOff size={13} />
          Ignore
        </button>
      ) : null}
    </div>
  );

  if (typeof document === "undefined") {
    return menu;
  }

  return createPortal(menu, document.body);
}

function initialTreeContextMenuPosition(
  anchorRect: ContextMenuOpenContext["anchorRect"],
): TreeContextMenuPosition {
  const left = Math.max(
    treeContextMenuViewportPadding,
    anchorRect.left - treeContextMenuEstimatedWidth - treeContextMenuGap,
  );
  const top = Math.max(treeContextMenuViewportPadding, anchorRect.top);
  return { left, top };
}

function placeTreeContextMenu(
  anchorRect: ContextMenuOpenContext["anchorRect"],
  menuRect: { readonly height: number; readonly width: number },
): TreeContextMenuPosition {
  const maxLeft = Math.max(
    treeContextMenuViewportPadding,
    window.innerWidth - menuRect.width - treeContextMenuViewportPadding,
  );
  const preferredLeft = anchorRect.left - menuRect.width - treeContextMenuGap;
  const fallbackRight = anchorRect.right + treeContextMenuGap;
  const left =
    preferredLeft >= treeContextMenuViewportPadding
      ? preferredLeft
      : clamp(fallbackRight, treeContextMenuViewportPadding, maxLeft);

  const maxTop = Math.max(
    treeContextMenuViewportPadding,
    window.innerHeight - menuRect.height - treeContextMenuViewportPadding,
  );
  const top = clamp(anchorRect.top, treeContextMenuViewportPadding, maxTop);

  return { left, top };
}

function parentPathFromTreePath(path: string): string | null {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return null;
  }
  return `${parts.slice(0, -1).join("/")}/`;
}
