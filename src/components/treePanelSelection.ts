import type { FileTree, FileTreeDirectoryHandle } from "@pierre/trees";
import type { TreeFile } from "../lib/api";
import { ancestorDirectoryPaths } from "./treePanelData";

interface SyncTreePanelSelectedPathOptions {
  readonly model: FileTree;
  readonly selectablePaths: ReadonlySet<string>;
  readonly selectedPath: string | null;
}

interface TreeContextFilesForSelectionOptions {
  readonly fileByPath: ReadonlyMap<string, TreeFile>;
  readonly itemPath: string;
  readonly selectedPaths: readonly string[];
}

interface SelectTreePanelFilePathsOptions {
  readonly model: FileTree;
  readonly selectablePaths: ReadonlySet<string>;
}

interface TreeSelectAllShortcutInput {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly defaultPrevented: boolean;
  readonly isComposing: boolean;
  readonly key: string;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

export function syncTreePanelSelectedPath({
  model,
  selectablePaths,
  selectedPath,
}: SyncTreePanelSelectedPathOptions): void {
  const selectedPaths = model.getSelectedPaths();
  if (!selectedPath || !selectablePaths.has(selectedPath)) {
    for (const selected of selectedPaths) {
      model.getItem(selected)?.deselect();
    }
    return;
  }

  for (const directoryPath of ancestorDirectoryPaths(selectedPath)) {
    const item = model.getItem(directoryPath);
    if (isDirectoryHandle(item)) {
      item.expand();
    }
  }

  if (!selectedPaths.includes(selectedPath)) {
    for (const selected of selectedPaths) {
      model.getItem(selected)?.deselect();
    }
    model.getItem(selectedPath)?.select();
  }

  model.scrollToPath(selectedPath);
}

export function treeContextFilesForSelection({
  fileByPath,
  itemPath,
  selectedPaths,
}: TreeContextFilesForSelectionOptions): readonly TreeFile[] {
  const itemFile = fileByPath.get(itemPath);
  if (!itemFile) {
    return [];
  }

  const selectedFiles = selectedPaths.flatMap((path) => {
    const file = fileByPath.get(path);
    return file ? [file] : [];
  });
  const clickedFileIsSelected = selectedFiles.some(
    (file) => file.path === itemFile.path,
  );

  return clickedFileIsSelected && selectedFiles.length > 1
    ? selectedFiles
    : [itemFile];
}

export function selectTreePanelFilePaths({
  model,
  selectablePaths,
}: SelectTreePanelFilePathsOptions): readonly string[] {
  for (const path of selectablePaths) {
    model.getItem(path)?.select();
  }

  return model.getSelectedPaths();
}

export function isDirectoryHandle(
  item: ReturnType<FileTree["getItem"]>,
): item is FileTreeDirectoryHandle {
  return item?.isDirectory() === true;
}

export function isTreeSelectAllShortcut({
  altKey,
  ctrlKey,
  defaultPrevented,
  isComposing,
  key,
  metaKey,
  shiftKey,
}: TreeSelectAllShortcutInput): boolean {
  return (
    !defaultPrevented &&
    !isComposing &&
    altKey &&
    !ctrlKey &&
    !metaKey &&
    !shiftKey &&
    key.toLowerCase() === "a"
  );
}
