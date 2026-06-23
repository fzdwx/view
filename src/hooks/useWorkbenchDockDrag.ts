import { useCallback, useEffect, useRef, useState } from "react";
import { createDockDragTokenStore } from "../lib/dockDragToken";
import type { GitPanelId, RailItemId } from "../lib/workbenchTypes";

export interface WorkbenchDockDragController {
  readonly clearDockDrag: () => void;
  readonly draggedGitPanel: GitPanelId | null;
  readonly draggedRailItem: RailItemId | null;
  readonly startGitPanelDrag: (panel: GitPanelId) => void;
  readonly startRailItemDrag: (item: RailItemId) => void;
}

export function useWorkbenchDockDrag(): WorkbenchDockDragController {
  const [draggedGitPanel, setDraggedGitPanel] = useState<GitPanelId | null>(null);
  const [draggedRailItem, setDraggedRailItem] = useState<RailItemId | null>(null);
  const railDragTokenRef = useRef(createDockDragTokenStore());

  const clearDockDrag = useCallback(() => {
    railDragTokenRef.current.cancel();
    setDraggedGitPanel(null);
    setDraggedRailItem(null);
  }, []);

  const clearDockDragRef = useRef(clearDockDrag);
  clearDockDragRef.current = clearDockDrag;

  useEffect(() => {
    const handler = () => clearDockDragRef.current();
    window.addEventListener("dragend", handler);
    window.addEventListener("drop", handler);
    return () => {
      window.removeEventListener("dragend", handler);
      window.removeEventListener("drop", handler);
    };
  }, []);

  const startGitPanelDrag = useCallback((panel: GitPanelId) => {
    setDraggedGitPanel(panel);
  }, []);

  const startRailItemDrag = useCallback((item: RailItemId) => {
    const dragToken = railDragTokenRef.current.next();
    // Rendering the overlay synchronously inside dragstart cancels the native drag.
    window.requestAnimationFrame(() => {
      if (railDragTokenRef.current.isCurrent(dragToken)) {
        setDraggedRailItem(item);
      }
    });
  }, []);

  return {
    clearDockDrag,
    draggedGitPanel,
    draggedRailItem,
    startGitPanelDrag,
    startRailItemDrag,
  };
}
