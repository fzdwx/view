import { FileTree, useFileTree } from "@pierre/trees/react";
import type {
  FileTreeDirectoryHandle,
  FileTreeInitialExpansion,
  FileTreeItemHandle,
} from "@pierre/trees";
import {
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
import {
  TreeContextMenu,
  type TreeGitFileActions,
  hasTreeContextMenuActions,
} from "./TreeContextMenu";
import { TreeEmptyState, TreePanelHeader } from "./TreePanelChrome";
import {
  ancestorDirectoryPaths,
  buildTreePanelData,
  directoryPathsFor,
} from "./treePanelData";
import { getClickedFilePath } from "./treePanelPointer";
import {
  fileTreeIcons,
  treeContentAlignmentCss,
  treeDarkThemeStyles,
} from "./treePanelTheme";

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
  gitFileActions?: TreeGitFileActions;
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
  gitFileActions,
  onSelectPath,
}: TreePanelProps) {
  const treeData = useMemo(() => buildTreePanelData(files), [files]);

  const { paths, preparedInput, selectablePaths, fileByPath, gitStatus } =
    treeData;
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
    unsafeCSS: treeContentAlignmentCss,
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
  const handleCreateRootFile = useCallback(() => {
    onCreateFile?.(null);
  }, [onCreateFile]);
  const createRootFile = onCreateFile ? handleCreateRootFile : undefined;

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
      <TreeEmptyState
        emptyCopy={emptyCopy}
        emptyTitle={emptyTitle}
        onCreateRootFile={createRootFile}
      />
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
          <TreePanelHeader
            fileCount={files.length}
            title={title}
            onCreateRootFile={createRootFile}
            onDragEnd={onDragEnd}
            onDragStart={onDragStart}
          />
        ) : null
      }
      renderContextMenu={
        hasTreeContextMenuActions({
          canStartRename: Boolean(onRenameFile),
          gitFileActions,
          onCreateFile,
          onDeleteFile,
        })
          ? (item, context) => (
              <TreeContextMenu
                item={item}
                context={context}
                file={
                  item.kind === "directory"
                    ? null
                    : (fileByPath.get(item.path) ?? null)
                }
                gitFileActions={gitFileActions}
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

function isDirectoryHandle(
  item: FileTreeItemHandle,
): item is FileTreeDirectoryHandle {
  return item.isDirectory();
}
