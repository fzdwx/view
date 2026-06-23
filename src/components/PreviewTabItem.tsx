import type { DragEvent, MouseEvent } from "react";
import { GitCompare, TerminalSquare, X } from "lucide-react";
import { useFileIcon } from "../lib/fileIcons";
import { fileNameFromPath } from "../lib/pathLabels";
import { writePreviewTabDragData } from "../lib/previewTabDrag";
import type { PreviewTab } from "../lib/previewTabs";

export function PreviewTabItem({
  dragOver,
  dragging,
  dirty,
  active,
  tab,
  onAuxClick,
  onClose,
  onContextMenu,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onSelect,
}: {
  readonly dragOver: boolean;
  readonly dragging: boolean;
  readonly dirty: boolean;
  readonly active: boolean;
  readonly tab: PreviewTab;
  readonly onAuxClick: (event: MouseEvent, tabId: string) => void;
  readonly onClose: (tabId: string) => void;
  readonly onContextMenu: (event: MouseEvent, tab: PreviewTab) => void;
  readonly onDragEnd: () => void;
  readonly onDragOver: (event: DragEvent, tabId: string) => void;
  readonly onDragStart: (event: DragEvent, tabId: string) => void;
  readonly onDrop: (event: DragEvent, tabId: string) => void;
  readonly onSelect: (tab: PreviewTab) => void;
}) {
  return (
    <div
      className={[
        active ? "preview-tab active" : "preview-tab",
        dragging ? "dragging" : "",
        dragOver ? "drag-over" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      title={previewTabTitle(tab)}
      draggable
      onDragStart={(event) => {
        writePreviewTabDragData(event.dataTransfer, { tabId: tab.id });
        onDragStart(event, tab.id);
      }}
      onDragOver={(event) => onDragOver(event, tab.id)}
      onDrop={(event) => onDrop(event, tab.id)}
      onDragEnd={onDragEnd}
      onAuxClick={(event) => onAuxClick(event, tab.id)}
      onContextMenu={(event) => onContextMenu(event, tab)}
    >
      <button
        type="button"
        className="preview-tab-select"
        role="tab"
        aria-selected={active}
        onClick={() => onSelect(tab)}
      >
        <span
          className={
            tab.mode === "diff"
              ? "preview-tab-kind diff"
              : tab.mode === "terminal"
                ? "preview-tab-kind terminal"
                : "preview-tab-kind"
          }
        >
          {tab.mode === "diff" ? (
            <GitCompare size={11} />
          ) : tab.mode === "terminal" ? (
            <TerminalSquare size={12} />
          ) : (
            <PreviewTabFileIcon path={tab.path} />
          )}
        </span>
        <span className="preview-tab-name">{previewTabTitle(tab)}</span>
        {dirty ? (
          <span className="preview-tab-dirty" aria-label="Unsaved changes" />
        ) : null}
      </button>
      <button
        type="button"
        className={
          dirty
            ? "preview-tab-close preview-tab-close-dirty"
            : "preview-tab-close"
        }
        aria-label={`Close ${previewTabTitle(tab)}`}
        onClick={(event) => {
          event.stopPropagation();
          onClose(tab.id);
        }}
      >
        <X size={12} />
      </button>
    </div>
  );
}

function previewTabTitle(tab: PreviewTab): string {
  return tab.mode === "terminal" ? tab.path : fileNameFromPath(tab.path);
}

function PreviewTabFileIcon({ path }: { readonly path: string }) {
  const icon = useFileIcon(path);
  return (
    <svg
      width={14}
      height={14}
      viewBox={icon.viewBox ?? "0 0 16 16"}
      className="preview-tab-file-icon"
      style={{ color: icon.color }}
      aria-hidden="true"
    >
      <use href={`#${icon.name}`} />
    </svg>
  );
}
