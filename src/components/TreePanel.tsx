import { themeToTreeStyles } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import pierreDarkTheme from "@pierre/theme/pierre-dark";
import type {
  FileTreeDirectoryHandle,
  FileTreeInitialExpansion,
  FileTreeItemHandle,
  GitStatusEntry,
} from "@pierre/trees";
import {
  type CSSProperties,
  type DragEvent,
  type ReactNode,
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
  onSelectPath(path: string): void;
}

export function TreePanel({
  files,
  selectedPath,
  title = "Files",
  showHeader = true,
  initialExpansion = "closed",
  emptyTitle = "No files",
  emptyCopy = "There are no files to show.",
  onDragEnd,
  onDragStart,
  onSelectPath,
}: TreePanelProps) {
  const treeData = useMemo(() => {
    const paths = files.map((file) => file.path);
    const gitStatus = files
      .filter((file) => file.status)
      .map((file) => ({
        path: file.path,
        status: file.status,
      })) as GitStatusEntry[];

    return {
      paths,
      selectablePaths: new Set(paths),
      gitStatus,
    };
  }, [files]);

  const { paths, selectablePaths, gitStatus } = treeData;
  const selectablePathsRef = useRef(selectablePaths);
  const onSelectPathRef = useRef(onSelectPath);

  selectablePathsRef.current = selectablePaths;
  onSelectPathRef.current = onSelectPath;

  const { model } = useFileTree({
    paths,
    gitStatus,
    initialExpansion,
    initialSelectedPaths: selectedPath ? [selectedPath] : [],
    density: "compact",
    search: true,
    onSelectionChange: ([path]) => {
      if (path && selectablePathsRef.current.has(path)) {
        onSelectPathRef.current(path);
      }
    },
  });

  const syncSelectedPath = useCallback(() => {
    if (!selectedPath || !selectablePaths.has(selectedPath)) {
      return;
    }

    for (const directoryPath of ancestorDirectoryPaths(selectedPath)) {
      const item = model.getItem(directoryPath);
      if (item && isDirectoryHandle(item)) {
        item.expand();
      }
    }
    for (const selected of model.getSelectedPaths()) {
      model.getItem(selected)?.deselect();
    }
    model.getItem(selectedPath)?.select();
    model.scrollToPath(selectedPath);
  }, [model, selectablePaths, selectedPath]);

  useEffect(() => {
    model.resetPaths(paths, {
      initialExpandedPaths:
        initialExpansion === "open" ? directoryPathsFor(paths) : [],
    });
    model.setGitStatus(gitStatus);
    model.setSearch(null);
  }, [initialExpansion, model, paths, gitStatus]);

  useEffect(() => {
    syncSelectedPath();
  }, [syncSelectedPath]);

  if (files.length === 0) {
    return (
      <div className="tree-empty-state">
        <div className="empty-title">{emptyTitle}</div>
        <div className="empty-copy">{emptyCopy}</div>
      </div>
    );
  }

  return (
    <FileTree
      className="file-tree-host"
      model={model}
      style={treeDarkThemeStyles}
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
            <span>{files.length}</span>
          </div>
        ) : null
      }
    />
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

function directoryPathsFor(paths: readonly string[]): string[] {
  const directories = new Set<string>();
  for (const path of paths) {
    for (const directoryPath of ancestorDirectoryPaths(path)) {
      directories.add(directoryPath);
    }
  }
  return [...directories];
}

function isDirectoryHandle(
  item: FileTreeItemHandle,
): item is FileTreeDirectoryHandle {
  return item.isDirectory();
}
