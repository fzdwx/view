import { FileTree, useFileTree } from "@pierre/trees/react";
import type {
  FileTreeInitialExpansion,
  FileTreeRowDecorationContext,
} from "@pierre/trees";
import {
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type { TreeFile } from "../lib/api";
import { clipboardFilesFromEvent } from "../lib/clipboardFiles";
import { parentPathFromPath } from "../lib/pathLabels";
import { timeSync } from "../lib/performanceLog";
import { treeFilesSignature } from "../lib/treeFileIdentity";
import type { TreeGitFileActions } from "./TreeContextMenu";
import { hasTreeContextMenuActions } from "./TreeContextMenu";
import { TreeEmptyState, TreePanelHeader } from "./TreePanelChrome";
import { TreePanelContextMenuHost } from "./TreePanelContextMenuHost";
import { treeGitStageDecoration } from "./treePanelGitDecorations";
import { buildTreePanelData, directoryPathsFor } from "./treePanelData";
import {
  isDirectoryHandle,
  syncTreePanelSelectedPath,
} from "./treePanelSelection";
import {
  fileTreeIcons,
  treeContentAlignmentCss,
  treeDarkThemeStyles,
} from "./treePanelTheme";
import { useTreePanelInputHandlers } from "./useTreePanelInputHandlers";
import { usePanelResizeActive } from "../hooks/usePanelResizeActive";
import { usePanelResizeDeferredValue } from "../hooks/usePanelResizeDeferredValue";

const treePanelOverscan = 6;

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
  onPasteFiles?(files: File[], destDir: string | null): void;
  onRenameFile?(fromPath: string, toPath: string): void;
  onRunScript?(): void;
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
  onPasteFiles,
  onRenameFile,
  onRunScript,
  gitFileActions,
  onSelectPath,
}: TreePanelProps) {
  const deferredFiles = usePanelResizeDeferredValue(files);
  const panelResizeActive = usePanelResizeActive();
  const treeDataCacheRef = useRef<{
    readonly data: ReturnType<typeof buildTreePanelData>;
    readonly signature: string;
  } | null>(null);
  const treeData = useMemo(() => {
    const signature = treeFilesSignature(deferredFiles);
    const cached = treeDataCacheRef.current;
    if (cached?.signature === signature) {
      return cached.data;
    }

    const nextData = buildTreePanelData(deferredFiles);
    treeDataCacheRef.current = {
      data: nextData,
      signature,
    };
    return nextData;
  }, [deferredFiles]);

  const { paths, preparedInput, selectablePaths, fileByPath, gitStatus } =
    treeData;
  const fileByPathRef = useRef(fileByPath);
  const selectablePathsRef = useRef(selectablePaths);
  const lastTreeSelectionPathRef = useRef(selectedPath);
  const onSelectPathRef = useRef(onSelectPath);
  const selectedPathRef = useRef(selectedPath);
  const selectAbortRef = useRef<AbortController | null>(null);
  const pendingSelectFrameRef = useRef<number | null>(null);
  const treeSelectedPathsRef = useRef<readonly string[]>(
    selectedPath ? [selectedPath] : [],
  );

  fileByPathRef.current = fileByPath;
  selectablePathsRef.current = selectablePaths;
  onSelectPathRef.current = onSelectPath;
  selectedPathRef.current = selectedPath;

  const renderTreeGitStageDecoration = useCallback(
    (context: FileTreeRowDecorationContext) =>
      treeGitStageDecoration(fileByPathRef.current.get(context.item.path) ?? null),
    [],
  );
  const scheduleSelectPath = useCallback((path: string) => {
    if (pendingSelectFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingSelectFrameRef.current);
    }
    pendingSelectFrameRef.current = window.requestAnimationFrame(() => {
      pendingSelectFrameRef.current = null;
      if (selectAbortRef.current?.signal.aborted) {
        return;
      }
      if (
        selectedPathRef.current === path ||
        !selectablePathsRef.current.has(path)
      ) {
        return;
      }
      onSelectPathRef.current(path);
    });
  }, []);

  const { model } = useFileTree({
    preparedInput,
    gitStatus,
    initialExpansion,
    initialSelectedPaths: selectedPath ? [selectedPath] : [],
    density: "compact",
    icons: fileTreeIcons,
    overscan: treePanelOverscan,
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
    renderRowDecoration: renderTreeGitStageDecoration,
    onSelectionChange: (selectedPaths) => {
      treeSelectedPathsRef.current = selectedPaths;
      const path = selectedPaths[0] ?? null;
      lastTreeSelectionPathRef.current = path ?? null;
      if (path && selectablePathsRef.current.has(path)) {
        scheduleSelectPath(path);
      }
    },
  });

  const syncSelectedPath = useCallback(() => {
    if (selectedPath && lastTreeSelectionPathRef.current === selectedPath) {
      return;
    }

    syncTreePanelSelectedPath({ model, selectablePaths, selectedPath });
    treeSelectedPathsRef.current = model.getSelectedPaths();
  }, [model, selectablePaths, selectedPath, treeSelectedPathsRef]);

  const {
    handleTreeClickCapture,
    handleTreeContextMenuCapture,
    handleTreeKeyDownCapture,
  } = useTreePanelInputHandlers({
    lastTreeSelectionPathRef,
    model,
    onSelectPathRef,
    selectablePathsRef,
    selectedPathRef,
    treeSelectedPathsRef,
  });
  const handleCreateRootFile = useCallback(() => {
    onCreateFile?.(null);
  }, [onCreateFile]);
  const createRootFile = onCreateFile ? handleCreateRootFile : undefined;

  const onPasteFilesRef = useRef(onPasteFiles);
  onPasteFilesRef.current = onPasteFiles;

  const handleTreePaste = useCallback(
    (event: ClipboardEvent<HTMLElement>) => {
      const callback = onPasteFilesRef.current;
      if (!callback) {
        return;
      }
      const pastedFiles = clipboardFilesFromEvent(event.nativeEvent);
      if (pastedFiles.length === 0) {
        return;
      }
      event.preventDefault();
      const current = selectedPathRef.current;
      let destDir: string | null = null;
      if (current) {
        const item = model.getItem(current);
        destDir = isDirectoryHandle(item)
          ? current.replace(/\/$/, "")
          : parentDirectoryFromTreePath(current);
      }
      callback(pastedFiles, destDir);
    },
    [model],
  );

  useEffect(() => {
    timeSync(
      "tree:model-reset",
      () => {
        model.resetPaths(paths, {
          preparedInput,
          initialExpandedPaths:
            initialExpansion === "open" ? directoryPathsFor(paths) : [],
        });
        model.setGitStatus(gitStatus);
        model.setIcons(fileTreeIcons);
        model.setSearch(null);
      },
      {
        paths: paths.length,
        gitStatus: gitStatus.length,
        initialExpansion,
      },
    );
  }, [initialExpansion, model, paths, preparedInput, gitStatus]);

  useEffect(() => {
    syncSelectedPath();
  }, [syncSelectedPath]);

  useEffect(() => {
    const abortController = new AbortController();
    selectAbortRef.current = abortController;
    return () => abortController.abort();
  }, []);

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
      data-view-panel-resizing={panelResizeActive ? "true" : undefined}
      onClickCapture={handleTreeClickCapture}
      onContextMenuCapture={handleTreeContextMenuCapture}
      onKeyDownCapture={handleTreeKeyDownCapture}
      onPaste={onPasteFiles ? handleTreePaste : undefined}
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
          onRunScript,
        })
          ? (item, context) => (
              <TreePanelContextMenuHost
                canRename={Boolean(onRenameFile)}
                context={context}
                fileByPath={fileByPath}
                gitFileActions={gitFileActions}
                item={item}
                model={model}
                onCreateFile={onCreateFile}
                onDeleteFile={onDeleteFile}
                onRunScript={onRunScript}
                selectedPaths={treeSelectedPathsRef.current}
              />
            )
          : undefined
      }
    />
  );
});

/// Parent directory of a tree path, or null for a root-level entry.
function parentDirectoryFromTreePath(path: string): string | null {
  const parent = parentPathFromPath(path);
  return parent === "" ? null : parent;
}
