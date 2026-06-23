import { useCallback, useState, type DragEvent } from "react";
import { readTerminalTabDragData } from "../../lib/terminalTabDrag";
import { acceptsTerminalTabEditorDrop } from "../../lib/terminalTabDropTarget";
import type { PreviewPaneId } from "../../lib/previewPanes";

interface PreviewPaneTerminalDropOptions {
  readonly paneId: PreviewPaneId;
  readonly onOpenTerminalTab: (
    paneId: PreviewPaneId,
    projectPath: string,
    terminalTabId: string,
    title: string,
  ) => void;
}

export function usePreviewPaneTerminalDrop({
  paneId,
  onOpenTerminalTab,
}: PreviewPaneTerminalDropOptions): {
  readonly dragging: boolean;
  readonly onDragLeaveCapture: (event: DragEvent<HTMLElement>) => void;
  readonly onDragOverCapture: (event: DragEvent<HTMLElement>) => void;
  readonly onDropCapture: (event: DragEvent<HTMLElement>) => void;
} {
  const [dragging, setDragging] = useState(false);

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    if (!isTerminalEditorPaneDrop(event)) {
      setDragging(false);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
    const relatedTarget = event.relatedTarget;
    if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) {
      setDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!isTerminalEditorPaneDrop(event)) {
        setDragging(false);
        return;
      }

      const payload = readTerminalTabDragData(event.dataTransfer);
      setDragging(false);
      if (!payload) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      onOpenTerminalTab(paneId, payload.projectPath, payload.tabId, payload.title);
    },
    [onOpenTerminalTab, paneId],
  );

  return {
    dragging,
    onDragLeaveCapture: handleDragLeave,
    onDragOverCapture: handleDragOver,
    onDropCapture: handleDrop,
  };
}

function isTerminalEditorPaneDrop(event: DragEvent<HTMLElement>): boolean {
  return acceptsTerminalTabEditorDrop({
    dataTransfer: event.dataTransfer,
    isWithinEditorPane: isWithinCurrentTarget(event),
  });
}

function isWithinCurrentTarget(event: DragEvent<HTMLElement>): boolean {
  return (
    event.target === event.currentTarget ||
    (event.target instanceof Node && event.currentTarget.contains(event.target))
  );
}
