import { FileTree, useFileTree } from "@pierre/trees/react";
import type { GitStatusEntry } from "@pierre/trees";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { TreeFile } from "../lib/api";

interface TreePanelProps {
  files: TreeFile[];
  selectedPath: string | null;
  title?: string;
  emptyTitle?: string;
  emptyCopy?: string;
  onSelectPath(path: string): void;
}

export function TreePanel({
  files,
  selectedPath,
  title = "Files",
  emptyTitle = "No files",
  emptyCopy = "There are no files to show.",
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
      expandedPaths: parentDirectoryPaths(paths),
      selectablePaths: new Set(paths),
      gitStatus,
    };
  }, [files]);

  const { paths, expandedPaths, selectablePaths, gitStatus } = treeData;
  const selectablePathsRef = useRef(selectablePaths);
  const onSelectPathRef = useRef(onSelectPath);

  selectablePathsRef.current = selectablePaths;
  onSelectPathRef.current = onSelectPath;

  const { model } = useFileTree({
    paths,
    gitStatus,
    initialExpansion: 2,
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

    for (const selected of model.getSelectedPaths()) {
      model.getItem(selected)?.deselect();
    }
    model.getItem(selectedPath)?.select();
    model.scrollToPath(selectedPath);
  }, [model, selectablePaths, selectedPath]);

  useEffect(() => {
    model.resetPaths(paths, {
      initialExpandedPaths: expandedPaths,
    });
    model.setGitStatus(gitStatus);
    model.setSearch(null);
  }, [model, treeData]);

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
      header={
        <div className="tree-header">
          <span>{title}</span>
          <span>{files.length}</span>
        </div>
      }
    />
  );
}

function parentDirectoryPaths(paths: string[]): string[] {
  const directories = new Set<string>();

  for (const path of paths) {
    const parts = path.split("/").filter(Boolean);
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(`${parts.slice(0, index).join("/")}/`);
    }
  }

  return Array.from(directories);
}
