import type { DragEvent, ReactNode } from "react";
import type { TreeFile } from "../../lib/api";
import { LoadingRows } from "../LoadingRows";
import { TreePanel } from "../TreePanel";
import type { TreeGitFileActions } from "../TreeContextMenu";

export interface ProjectFileTreePanelProps {
  readonly emptyCopy?: string;
  readonly emptyTitle?: string;
  readonly files: TreeFile[] | undefined;
  readonly gitFileActions?: TreeGitFileActions;
  readonly selectedPath: string | null;
  readonly title: ReactNode;
  readonly onCreateFile: (parentPath: string | null) => void;
  readonly onDeleteFile: (path: string) => void;
  readonly onDragEnd: () => void;
  readonly onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  readonly onRenameFile: (fromPath: string, toPath: string) => void;
  readonly onSelectPath: (path: string) => void;
}

export function ProjectFileTreePanel({
  emptyCopy = "Tracked and untracked files will appear here.",
  emptyTitle = "No project files",
  files,
  gitFileActions,
  selectedPath,
  title,
  onCreateFile,
  onDeleteFile,
  onDragEnd,
  onDragStart,
  onRenameFile,
  onSelectPath,
}: ProjectFileTreePanelProps) {
  return (
    <section className="tree-panel">
      {files ? (
        <TreePanel
          files={files}
          selectedPath={selectedPath}
          title={title}
          emptyTitle={emptyTitle}
          emptyCopy={emptyCopy}
          gitFileActions={gitFileActions}
          onDragEnd={onDragEnd}
          onDragStart={onDragStart}
          onCreateFile={onCreateFile}
          onDeleteFile={onDeleteFile}
          onRenameFile={onRenameFile}
          onSelectPath={onSelectPath}
        />
      ) : (
        <LoadingRows />
      )}
    </section>
  );
}
