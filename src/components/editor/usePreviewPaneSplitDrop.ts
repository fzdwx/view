import { useCallback, useState, type DragEvent } from "react";
import {
  editorPaneDropIntent,
  splitDirectionFromDropIntent,
  type EditorPaneDropIntent,
} from "../../lib/editorPaneDropIntent";
import {
  hasPreviewTabDragData,
  readPreviewTabDragData,
} from "../../lib/previewTabDrag";
import type {
  PreviewPane,
  PreviewPaneId,
  PreviewSplitDirection,
} from "../../lib/previewPanes";

interface PreviewPaneSplitDropOptions {
  readonly pane: PreviewPane;
  readonly onSplitTab: (
    paneId: PreviewPaneId,
    tabId: string,
    direction: PreviewSplitDirection,
  ) => void;
}

interface PreviewPaneSplitDropHandlers {
  readonly onDragOverCapture: (event: DragEvent<HTMLElement>) => void;
  readonly onDragLeaveCapture: (event: DragEvent<HTMLElement>) => void;
  readonly onDropCapture: (event: DragEvent<HTMLElement>) => void;
}

export function usePreviewPaneSplitDrop({
  pane,
  onSplitTab,
}: PreviewPaneSplitDropOptions): {
  readonly dragHandlers: PreviewPaneSplitDropHandlers;
  readonly intent: EditorPaneDropIntent | null;
} {
  const [intent, setIntent] = useState<EditorPaneDropIntent | null>(null);

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!hasPreviewTabDragData(event.dataTransfer) || isInsideTabbar(event.target)) {
        setIntent(null);
        return;
      }

      const nextIntent = editorPaneDropIntent(event, event.currentTarget.getBoundingClientRect());
      setIntent(nextIntent);
      if (!nextIntent) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
    },
    [],
  );

  const handleDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    const relatedTarget = event.relatedTarget;
    if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) {
      setIntent(null);
    }
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!hasPreviewTabDragData(event.dataTransfer) || isInsideTabbar(event.target)) {
        setIntent(null);
        return;
      }

      const nextIntent = editorPaneDropIntent(event, event.currentTarget.getBoundingClientRect());
      const payload = readPreviewTabDragData(event.dataTransfer);
      setIntent(null);
      if (!nextIntent || !payload || !pane.tabs.some((tab) => tab.id === payload.tabId)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      onSplitTab(pane.id, payload.tabId, splitDirectionFromDropIntent(nextIntent));
    },
    [onSplitTab, pane.id, pane.tabs],
  );

  return {
    dragHandlers: {
      onDragLeaveCapture: handleDragLeave,
      onDragOverCapture: handleDragOver,
      onDropCapture: handleDrop,
    },
    intent,
  };
}

export function previewPaneSurfaceClassName(
  active: boolean,
  intent: EditorPaneDropIntent | null,
): string {
  return [
    active ? "editor-pane active" : "editor-pane",
    intent ? `drop-${intent}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function isInsideTabbar(target: EventTarget): boolean {
  return target instanceof Element && Boolean(target.closest(".preview-tabbar"));
}
