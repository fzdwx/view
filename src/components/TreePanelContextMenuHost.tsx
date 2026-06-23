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
  readonly onCreateFile?: (parentPath: string | null) => void;
  readonly onDeleteFile?: (path: string) => void;
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
  onCreateFile,
  onDeleteFile,
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
      onCreateFile={onCreateFile}
      onDeleteFile={onDeleteFile}
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
