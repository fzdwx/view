import { prepareFileTreeInput, themeToTreeStyles } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import pierreDarkTheme from "@pierre/theme/pierre-dark";
import type {
  ContextMenuItem,
  ContextMenuOpenContext,
  FileTreeDirectoryHandle,
  FileTreeIcons,
  FileTreeInitialExpansion,
  FileTreeItemHandle,
  GitStatusEntry,
} from "@pierre/trees";
import { FilePlus2, Pencil, Trash2, X } from "lucide-react";
import {
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type { TreeFile } from "../lib/api";

const treeDarkThemeStyles = themeToTreeStyles({
  ...pierreDarkTheme,
  bg: "#000000",
  fg: "#d6d6d6",
  colors: {
    ...pierreDarkTheme.colors,
    "editor.background": "#000000",
    "editor.selectionBackground": "#242424",
    "focusBorder": "#3a3a3a",
    "input.background": "#0b0b0b",
    "input.border": "#151515",
    "list.activeSelectionBackground": "#242424",
    "list.activeSelectionForeground": "#d6d6d6",
    "list.focusOutline": "#3a3a3a",
    "list.hoverBackground": "#111111",
    "scrollbarSlider.background": "#636363",
    "sideBar.background": "#000000",
    "sideBar.border": "#151515",
    "sideBar.foreground": "#d6d6d6",
    "sideBarSectionHeader.background": "#000000",
    "sideBarSectionHeader.foreground": "#858585",
  },
}) as CSSProperties;

const fileTreeIcons: FileTreeIcons = {
  set: "complete",
  colored: true,
};

interface ClickedFilePath {
  readonly path: string;
  readonly selected: boolean;
}

interface TreePanelProps {
  files: TreeFile[];
  selectedPath: string | null;
  title?: ReactNode;
  showHeader?: boolean;
  initialExpansion?: FileTreeInitialExpansion;
  emptyTitle?: string;
  emptyCopy?: string;
  onDragEnd?(): void;
  onDragStart?(event: DragEvent<HTMLDivElement>): void;
  onCreateFile?(parentPath: string | null): void;
  onDeleteFile?(path: string): void;
  onRenameFile?(fromPath: string, toPath: string): void;
  onSelectPath(path: string): void;
}

export const TreePanel = memo(function TreePanel({
  files,
  selectedPath,
  title = "Files",
  showHeader = true,
  initialExpansion = "closed",
  emptyTitle = "No files",
  emptyCopy = "There are no files to show.",
  onDragEnd,
  onDragStart,
  onCreateFile,
  onDeleteFile,
  onRenameFile,
  onSelectPath,
}: TreePanelProps) {
  const treeData = useMemo(() => {
    const inputPaths = uniqueInputPaths(files);
    const preparedInput = prepareFileTreeInput(inputPaths);
    const paths = preparedInput.paths;
    const selectablePaths = new Set(paths);
    const statusByPath = new Map<string, TreeFile["status"]>();
    for (const file of files) {
      if (file.status && selectablePaths.has(file.path)) {
        statusByPath.set(file.path, file.status);
      }
    }
    const gitStatus = [...statusByPath].map(([path, status]) => ({
      path,
      status: status === "conflict" ? "modified" : status,
    })) as GitStatusEntry[];

    return {
      paths,
      preparedInput,
      selectablePaths,
      gitStatus,
    };
  }, [files]);

  const { paths, preparedInput, selectablePaths, gitStatus } = treeData;
  const selectablePathsRef = useRef(selectablePaths);
  const lastTreeSelectionPathRef = useRef(selectedPath);
  const onSelectPathRef = useRef(onSelectPath);
  const selectedPathRef = useRef(selectedPath);

  selectablePathsRef.current = selectablePaths;
  onSelectPathRef.current = onSelectPath;
  selectedPathRef.current = selectedPath;

  const { model } = useFileTree({
    preparedInput,
    gitStatus,
    initialExpansion,
    initialSelectedPaths: selectedPath ? [selectedPath] : [],
    density: "compact",
    icons: fileTreeIcons,
    renaming: onRenameFile
      ? {
          canRename: (item) => !item.isFolder,
          onRename: (event) => {
            onRenameFile(event.sourcePath, event.destinationPath);
          },
          onError: (error) => {
            console.warn("File tree rename failed", error);
          },
        }
      : false,
    search: true,
    stickyFolders: true,
    onSelectionChange: ([path]) => {
      lastTreeSelectionPathRef.current = path ?? null;
      if (path && selectablePathsRef.current.has(path)) {
        onSelectPathRef.current(path);
      }
    },
  });

  const syncSelectedPath = useCallback(() => {
    const selectedPaths = model.getSelectedPaths();
    if (!selectedPath || !selectablePaths.has(selectedPath)) {
      for (const selected of selectedPaths) {
        model.getItem(selected)?.deselect();
      }
      return;
    }

    for (const directoryPath of ancestorDirectoryPaths(selectedPath)) {
      const item = model.getItem(directoryPath);
      if (item && isDirectoryHandle(item)) {
        item.expand();
      }
    }

    const selectedAlready =
      selectedPaths.length === 1 && selectedPaths[0] === selectedPath;
    if (!selectedAlready) {
      for (const selected of selectedPaths) {
        model.getItem(selected)?.deselect();
      }
      model.getItem(selectedPath)?.select();
    }
    model.scrollToPath(selectedPath);
  }, [model, selectablePaths, selectedPath]);

  const handleTreeClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      const clickedFile = getClickedFilePath(event);
      if (!clickedFile || !selectablePathsRef.current.has(clickedFile.path)) {
        return;
      }
      if (
        !clickedFile.selected ||
        selectedPathRef.current === clickedFile.path ||
        lastTreeSelectionPathRef.current === clickedFile.path
      ) {
        return;
      }

      const path = clickedFile.path;
      window.requestAnimationFrame(() => {
        if (
          selectedPathRef.current === path ||
          lastTreeSelectionPathRef.current === path ||
          !selectablePathsRef.current.has(path)
        ) {
          return;
        }

        onSelectPathRef.current(path);
      });
    },
    [],
  );

  useEffect(() => {
    model.resetPaths(paths, {
      preparedInput,
      initialExpandedPaths:
        initialExpansion === "open" ? directoryPathsFor(paths) : [],
    });
    model.setGitStatus(gitStatus);
    model.setIcons(fileTreeIcons);
    model.setSearch(null);
  }, [initialExpansion, model, paths, preparedInput, gitStatus]);

  useEffect(() => {
    syncSelectedPath();
  }, [syncSelectedPath]);

  if (files.length === 0) {
    return (
      <div className="tree-empty-state">
        <div className="empty-title">{emptyTitle}</div>
        <div className="empty-copy">{emptyCopy}</div>
        {onCreateFile ? (
          <button
            className="ghost-button tree-empty-action"
            type="button"
            onClick={() => onCreateFile(null)}
          >
            <FilePlus2 size={14} />
            New file
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <FileTree
      className="file-tree-host"
      model={model}
      style={treeDarkThemeStyles}
      onClickCapture={handleTreeClickCapture}
      header={
        showHeader ? (
          <div
            className="tree-header"
            draggable={Boolean(onDragStart)}
            title="Drag to dock the file tree"
            onDragEnd={onDragEnd}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("application/x-view-panel", "tree");
              onDragStart?.(event);
            }}
          >
            <span className="tree-title">{title}</span>
            <span className="tree-header-actions">
              {onCreateFile ? (
                <button
                  className="icon-button tree-action-button"
                  type="button"
                  aria-label="New file"
                  title="New file"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCreateFile(null);
                  }}
                >
                  <FilePlus2 size={13} />
                </button>
              ) : null}
              <span>{files.length}</span>
            </span>
          </div>
        ) : null
      }
      renderContextMenu={
        onCreateFile || onDeleteFile || onRenameFile
          ? (item, context) => (
              <TreeContextMenu
                item={item}
                context={context}
                onCreateFile={onCreateFile}
                onDeleteFile={onDeleteFile}
                onStartRename={
                  onRenameFile
                    ? (path) => {
                        context.close({ restoreFocus: false });
                        model.startRenaming(path);
                      }
                    : undefined
                }
              />
            )
          : undefined
      }
    />
  );
});

function TreeContextMenu({
  context,
  item,
  onCreateFile,
  onDeleteFile,
  onStartRename,
}: {
  context: ContextMenuOpenContext;
  item: ContextMenuItem;
  onCreateFile?(parentPath: string | null): void;
  onDeleteFile?(path: string): void;
  onStartRename?(path: string): void;
}) {
  const parentPath =
    item.kind === "directory" ? item.path : parentPathFromTreePath(item.path);

  return (
    <div
      className="tree-context-menu"
      data-file-tree-context-menu-root="true"
      role="menu"
    >
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

function getClickedFilePath(
  event: ReactMouseEvent<HTMLElement>,
): ClickedFilePath | null {
  if (
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.defaultPrevented
  ) {
    return null;
  }

  for (const item of event.nativeEvent.composedPath()) {
    if (!(item instanceof HTMLElement)) {
      continue;
    }
    if (isTreeMenuOrEditorTarget(item)) {
      return null;
    }
    if (item.dataset.itemType === "file") {
      const path = item.dataset.itemPath;
      return path
        ? {
            path,
            selected: item.hasAttribute("data-item-selected"),
          }
        : null;
    }
  }

  return null;
}

function isTreeMenuOrEditorTarget(element: HTMLElement): boolean {
  return (
    element.dataset.fileTreeContextMenuRoot === "true" ||
    element.dataset.type === "context-menu-trigger" ||
    element.hasAttribute("data-item-rename-input") ||
    element.matches("input, textarea, button, [contenteditable='true']")
  );
}

function ancestorDirectoryPaths(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const directories: string[] = [];

  for (let index = 1; index < parts.length; index += 1) {
    directories.push(`${parts.slice(0, index).join("/")}/`);
  }

  return directories;
}

function parentPathFromTreePath(path: string): string | null {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return null;
  }
  return `${parts.slice(0, -1).join("/")}/`;
}

function directoryPathsFor(paths: readonly string[]): string[] {
  const directories = new Set<string>();
  for (const path of paths) {
    for (const directoryPath of ancestorDirectoryPaths(path)) {
      directories.add(directoryPath);
    }
  }
  return [...directories];
}

function uniqueInputPaths(files: readonly TreeFile[]): string[] {
  const seenPaths = new Set<string>();
  const paths: string[] = [];

  for (const file of files) {
    const path = file.path;
    if (!path || seenPaths.has(path)) {
      continue;
    }
    seenPaths.add(path);
    paths.push(path);
  }

  return paths;
}

function isDirectoryHandle(
  item: FileTreeItemHandle,
): item is FileTreeDirectoryHandle {
  return item.isDirectory();
}
