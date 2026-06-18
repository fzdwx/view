import { FilePlus2 } from "lucide-react";
import type { DragEvent, ReactNode } from "react";

interface TreeEmptyStateProps {
  readonly emptyCopy: string;
  readonly emptyTitle: string;
  readonly onCreateRootFile?: () => void;
}

interface TreePanelHeaderProps {
  readonly fileCount: number;
  readonly title: ReactNode;
  readonly onCreateRootFile?: () => void;
  readonly onDragEnd?: () => void;
  readonly onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
}

export function TreeEmptyState({
  emptyCopy,
  emptyTitle,
  onCreateRootFile,
}: TreeEmptyStateProps) {
  return (
    <div className="tree-empty-state">
      <div className="empty-title">{emptyTitle}</div>
      <div className="empty-copy">{emptyCopy}</div>
      {onCreateRootFile ? (
        <button
          className="ghost-button tree-empty-action"
          type="button"
          onClick={onCreateRootFile}
        >
          <FilePlus2 size={14} />
          New file
        </button>
      ) : null}
    </div>
  );
}

export function TreePanelHeader({
  fileCount,
  title,
  onCreateRootFile,
  onDragEnd,
  onDragStart,
}: TreePanelHeaderProps) {
  return (
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
        {onCreateRootFile ? (
          <button
            className="icon-button tree-action-button"
            type="button"
            aria-label="New file"
            title="New file"
            onClick={(event) => {
              event.stopPropagation();
              onCreateRootFile();
            }}
          >
            <FilePlus2 size={13} />
          </button>
        ) : null}
        <span>{fileCount}</span>
      </span>
    </div>
  );
}
