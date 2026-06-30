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
  readonly onCopyRelativePath: (path: string) => void;
  readonly onCreateDirectory: (parentPath: string | null) => void;
  readonly onCreateFile: (parentPath: string | null) => void;
  readonly onDeleteDirectory: (path: string) => void;
  readonly onDeleteFile: (path: string) => void;
  readonly onDragEnd?: () => void;
  readonly onPasteFiles?: (files: File[], destDir: string | null) => void;
  readonly onIgnorePath: (path: string, kind: "directory" | "file") => void;
  readonly onRevealPath: (path: string) => void;
  readonly onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  readonly onRenameFile: (fromPath: string, toPath: string) => void;
  readonly onRunScript?: () => void;
  readonly onSelectPath: (path: string) => void;
}

export function ProjectFileTreePanel({
  emptyCopy = "Tracked and untracked files will appear here.",
  emptyTitle = "No project files",
  files,
  gitFileActions,
  selectedPath,
  title,
  onCopyRelativePath,
  onCreateDirectory,
  onCreateFile,
  onDeleteDirectory,
  onDeleteFile,
  onDragEnd,
  onDragStart,
  onIgnorePath,
  onPasteFiles,
  onRevealPath,
  onRenameFile,
  onRunScript,
  onSelectPath,
}: ProjectFileTreePanelProps) {
  return (
    <section className="tree-panel">
      {files ? (
        <TreePanel
          files={files}
          selectedPath={selectedPath}
          showHeader={false}
          title={title}
          emptyTitle={emptyTitle}
          emptyCopy={emptyCopy}
          gitFileActions={gitFileActions}
          onDragEnd={onDragEnd}
          onDragStart={onDragStart}
          onCopyRelativePath={onCopyRelativePath}
          onCreateDirectory={onCreateDirectory}
          onCreateFile={onCreateFile}
          onDeleteDirectory={onDeleteDirectory}
          onDeleteFile={onDeleteFile}
          onIgnorePath={onIgnorePath}
          onPasteFiles={onPasteFiles}
          onRevealPath={onRevealPath}
          onRenameFile={onRenameFile}
          onRunScript={onRunScript}
          onSelectPath={onSelectPath}
        />
      ) : (
        <LoadingRows />
      )}
    </section>
  );
}
