import type {
  ContextMenuItem,
  ContextMenuOpenContext,
  FileTree,
} from "@pierre/trees";
import type { TreeFile } from "../lib/api";
import {
  TreeContextMenu,
  type TreeGitFileActions,
} from "./TreeContextMenu";
import { treeContextFilesForSelection } from "./treePanelSelection";

interface TreePanelContextMenuHostProps {
  readonly canRename: boolean;
  readonly context: ContextMenuOpenContext;
  readonly fileByPath: ReadonlyMap<string, TreeFile>;
  readonly gitFileActions?: TreeGitFileActions;
  readonly item: ContextMenuItem;
  readonly model: FileTree;
  readonly onCopyRelativePath?: (path: string) => void;
  readonly onCreateDirectory?: (parentPath: string | null) => void;
  readonly onCreateFile?: (parentPath: string | null) => void;
  readonly onDeleteDirectory?: (path: string) => void;
  readonly onDeleteFile?: (path: string) => void;
  readonly onIgnorePath?: (path: string, kind: "directory" | "file") => void;
  readonly onRevealPath?: (path: string) => void;
  readonly onRunScript?: () => void;
  readonly selectedPaths: readonly string[];
}

export function TreePanelContextMenuHost({
  canRename,
  context,
  fileByPath,
  gitFileActions,
  item,
  model,
  onCopyRelativePath,
  onCreateDirectory,
  onCreateFile,
  onDeleteDirectory,
  onDeleteFile,
  onIgnorePath,
  onRevealPath,
  onRunScript,
  selectedPaths,
}: TreePanelContextMenuHostProps) {
  return (
    <TreeContextMenu
      context={context}
      files={treeContextFilesForSelection({
        fileByPath,
        itemPath: item.path,
        selectedPaths,
      })}
      gitFileActions={gitFileActions}
      item={item}
      onCopyRelativePath={onCopyRelativePath}
      onCreateDirectory={onCreateDirectory}
      onCreateFile={onCreateFile}
      onDeleteDirectory={onDeleteDirectory}
      onDeleteFile={onDeleteFile}
      onIgnorePath={onIgnorePath}
      onRevealPath={onRevealPath}
      onRunScript={onRunScript}
      onStartRename={
        canRename
          ? (path: string) => {
              context.close({ restoreFocus: false });
              model.startRenaming(path);
            }
          : undefined
      }
    />
  );
}
