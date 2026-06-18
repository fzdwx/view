import { useCallback, useEffect, useState } from "react";
import { clamp } from "../lib/numeric";
import {
  isGitPanelId,
  loadWorkbenchLayout,
  saveWorkbenchLayout,
} from "../lib/workbenchLayout";
import type {
  EditorDock,
  GitPanelId,
  PanelSizes,
  ProjectDock,
  RailItemId,
  RailLayout,
  RailSide,
  RailSlot,
  TreeDock,
  ToolDock,
  ToolPanelId,
} from "../lib/workbenchTypes";

export interface WorkbenchDockController {
  readonly activityView: ToolPanelId;
  readonly detachedGitPanels: GitPanelId[];
  readonly draggedGitPanel: GitPanelId | null;
  readonly draggedToolPanel: ToolPanelId | null;
  readonly draggingEditorPanel: boolean;
  readonly draggingTreePanel: boolean;
  readonly gitPanelOrder: GitPanelId[];
  readonly panelSizes: PanelSizes;
  readonly projectInToolDock: boolean;
  readonly treeVisible: boolean;
  readonly toolDock: ToolDock;
  readonly toolPanelCollapsed: boolean;
  readonly treeDock: TreeDock;
  readonly clearDockDrag: () => void;
  readonly dockEditorPanel: (dock: EditorDock) => void;
  readonly dockProjectPanel: (dock: ProjectDock) => void;
  readonly dockToolPanel: (panel: ToolPanelId, dock: ToolDock) => void;
  readonly endToolPanelDrag: () => void;
  readonly moveGitPanel: (panel: GitPanelId, targetPanel: GitPanelId) => void;
  readonly toggleLeftRailTree: () => void;
  readonly toggleTreeVisible: () => void;
  readonly railLayout: RailLayout;
  readonly draggedRailItem: RailItemId | null;
  readonly toggleSideRailTree: () => void;
  readonly startRailItemDrag: (item: RailItemId) => void;
  readonly dropRailItem: (item: RailItemId, side: RailSide, slot: RailSlot) => void;
  readonly reattachGitPanel: (panel: GitPanelId) => void;
  readonly resizePanel: (
    key: keyof PanelSizes,
    delta: number,
    min: number,
    max: number,
  ) => void;
  readonly selectToolPanelView: (view: ToolPanelId) => void;
  readonly startEditorPanelDrag: () => void;
  readonly startGitPanelDrag: (panel: GitPanelId) => void;
  readonly startToolPanelDrag: (panel: ToolPanelId) => void;
  readonly startTreePanelDrag: () => void;
}

export function useWorkbenchDock(): WorkbenchDockController {
  const [initialLayout] = useState(loadWorkbenchLayout);
  const [activityView, setActivityView] = useState<ToolPanelId>(
    initialLayout.activityView,
  );
  const [toolPanelCollapsed, setToolPanelCollapsed] = useState(false);
  const [toolDock, setToolDock] = useState<ToolDock>(initialLayout.toolDock);
  const [draggedToolPanel, setDraggedToolPanel] = useState<ToolPanelId | null>(
    null,
  );
  const [treeDock, setTreeDock] = useState<TreeDock>(initialLayout.treeDock);
  const [projectInToolDock, setProjectInToolDock] = useState(
    initialLayout.projectInToolDock,
  );
  const [treeVisible, setTreeVisible] = useState(initialLayout.treeVisible);
  const [draggingTreePanel, setDraggingTreePanel] = useState(false);
  const [draggingEditorPanel, setDraggingEditorPanel] = useState(false);
  const [gitPanelOrder, setGitPanelOrder] = useState<GitPanelId[]>(
    initialLayout.gitPanelOrder,
  );
  const [detachedGitPanels, setDetachedGitPanels] = useState<GitPanelId[]>(
    initialLayout.detachedGitPanels,
  );
  const [draggedGitPanel, setDraggedGitPanel] = useState<GitPanelId | null>(null);
  const [panelSizes, setPanelSizes] = useState<PanelSizes>(
    initialLayout.panelSizes,
  );
  const [railLayout, setRailLayout] = useState<RailLayout>(
    initialLayout.railLayout,
  );
  const [draggedRailItem, setDraggedRailItem] = useState<RailItemId | null>(null);

  const clearDockDrag = useCallback(() => {
    setDraggedToolPanel(null);
    setDraggedGitPanel(null);
    setDraggingTreePanel(false);
    setDraggingEditorPanel(false);
    setDraggedRailItem(null);
  }, []);

  useEffect(() => {
    saveWorkbenchLayout({
      activityView,
      toolDock,
      treeDock,
      treeVisible,
      projectInToolDock,
      gitPanelOrder,
      detachedGitPanels,
      railLayout,
      panelSizes,
    });
  }, [
    activityView,
    detachedGitPanels,
    gitPanelOrder,
    panelSizes,
    projectInToolDock,
    railLayout,
    treeVisible,
    toolDock,
    treeDock,
  ]);

  useEffect(() => {
    window.addEventListener("dragend", clearDockDrag);
    window.addEventListener("drop", clearDockDrag);
    return () => {
      window.removeEventListener("dragend", clearDockDrag);
      window.removeEventListener("drop", clearDockDrag);
    };
  }, [clearDockDrag]);

  const resizePanel = useCallback(
    (key: keyof PanelSizes, delta: number, min: number, max: number) => {
      setPanelSizes((current) => ({
        ...current,
        [key]: clamp(current[key] + delta, min, max),
      }));
    },
    [],
  );

  const dockToolPanel = useCallback(
    (panel: ToolPanelId, dock: ToolDock) => {
      if (panel === "project") {
        setProjectInToolDock(true);
      } else if (isGitPanelId(panel)) {
        setDetachedGitPanels((current) =>
          current.includes(panel) ? current : [...current, panel],
        );
      }
      setActivityView(panel);
      setToolPanelCollapsed(false);
      setToolDock(dock);
      clearDockDrag();
    },
    [clearDockDrag],
  );

  const startToolPanelDrag = useCallback((panel: ToolPanelId) => {
    setDraggedToolPanel(panel);
    if (isGitPanelId(panel)) {
      setDraggedGitPanel(panel);
    }
  }, []);

  const startGitPanelDrag = useCallback((panel: GitPanelId) => {
    setDraggedGitPanel(panel);
  }, []);

  const endToolPanelDrag = useCallback(() => {
    clearDockDrag();
  }, [clearDockDrag]);

  const dockProjectPanel = useCallback(
    (nextDock: ProjectDock) => {
      if (nextDock === "panel") {
        setProjectInToolDock(true);
        setActivityView("project");
        setToolPanelCollapsed(false);
        setToolDock("bottom");
        clearDockDrag();
        return;
      }

      setProjectInToolDock(false);
      setTreeDock(nextDock);
      setTreeVisible(true);
      if (activityView === "project") {
        setActivityView("git");
        setToolPanelCollapsed(false);
      }
      clearDockDrag();
    },
    [activityView, clearDockDrag],
  );

  const selectToolPanelView = useCallback(
    (view: ToolPanelId) => {
      if (toolDock === "bottom" && activityView === view) {
        setToolPanelCollapsed((collapsed) => !collapsed);
        return;
      }

      setActivityView(view);
      setToolPanelCollapsed(false);
    },
    [activityView, toolDock],
  );

  const dockEditorPanel = useCallback(
    (nextDock: EditorDock) => {
      setTreeDock(nextDock === "left" ? "right" : "left");
      clearDockDrag();
    },
    [clearDockDrag],
  );

  const moveGitPanel = useCallback(
    (panel: GitPanelId, targetPanel: GitPanelId) => {
      setDetachedGitPanels((current) => current.filter((item) => item !== panel));
      setGitPanelOrder((current) => {
        if (panel === targetPanel) {
          return current;
        }

        const nextOrder = current.filter((item) => item !== panel);
        const targetIndex = nextOrder.indexOf(targetPanel);
        if (targetIndex === -1) {
          return current;
        }

        nextOrder.splice(targetIndex, 0, panel);
        return nextOrder;
      });
      if (activityView === panel) {
        setActivityView("git");
        setToolPanelCollapsed(false);
      }
      clearDockDrag();
    },
    [activityView, clearDockDrag],
  );

  const toggleLeftRailTree = useCallback(() => {
    if (treeDock !== "left") {
      setProjectInToolDock(false);
      setTreeDock("left");
      setTreeVisible(true);
      return;
    }
    setTreeVisible((visible) => !visible);
  }, [treeDock]);

  const toggleTreeVisible = useCallback(() => {
    setTreeVisible((visible) => !visible);
  }, []);

  const toggleSideRailTree = useCallback(() => {
    if (treeDock !== "right") {
      setProjectInToolDock(false);
      setTreeDock("right");
      setTreeVisible(true);
      return;
    }
    setTreeVisible((visible) => !visible);
  }, [treeDock]);

  const reattachGitPanel = useCallback(
    (panel: GitPanelId) => {
      setDetachedGitPanels((current) => current.filter((item) => item !== panel));
      if (activityView === panel) {
        setActivityView("git");
        setToolPanelCollapsed(false);
      }
      clearDockDrag();
    },
    [activityView, clearDockDrag],
  );

  const startRailItemDrag = useCallback((item: RailItemId) => {
    // Defer setting drag state until after dragstart completes; rendering the
    // dock overlay synchronously during dragstart cancels the native drag.
    window.requestAnimationFrame(() => {
      setDraggedRailItem(item);
    });
  }, []);

  const dropRailItem = useCallback(
    (item: RailItemId, side: RailSide, slot: RailSlot) => {
      setRailLayout((current) => {
        const next: RailLayout = {
          left: { top: [...current.left.top], bottom: [...current.left.bottom] },
          right: { top: [...current.right.top], bottom: [...current.right.bottom] },
        };
        for (const railSide of ["left", "right"] as const) {
          for (const railSlot of ["top", "bottom"] as const) {
            next[railSide][railSlot] = next[railSide][railSlot].filter(
              (existing) => existing !== item,
            );
          }
        }
        next[side][slot] = [...next[side][slot], item];
        return next;
      });
      setDraggedRailItem(null);
    },
    [],
  );

  const startTreePanelDrag = useCallback(() => {
    setDraggingTreePanel(true);
  }, []);

  const startEditorPanelDrag = useCallback(() => {
    setDraggingEditorPanel(true);
  }, []);

  return {
    activityView,
    detachedGitPanels,
    draggedGitPanel,
    draggedToolPanel,
    draggingEditorPanel,
    draggingTreePanel,
    gitPanelOrder,
    panelSizes,
    projectInToolDock,
    treeVisible,
    toolDock,
    toolPanelCollapsed,
    treeDock,
    railLayout,
    draggedRailItem,
    startRailItemDrag,
    dropRailItem,
    clearDockDrag,
    dockEditorPanel,
    dockProjectPanel,
    dockToolPanel,
    endToolPanelDrag,
    moveGitPanel,
    reattachGitPanel,
    resizePanel,
    selectToolPanelView,
    startEditorPanelDrag,
    startGitPanelDrag,
    startToolPanelDrag,
    startTreePanelDrag,
    toggleLeftRailTree,
    toggleTreeVisible,
    toggleSideRailTree,
  };
}
