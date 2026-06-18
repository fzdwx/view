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
  readonly toolDock: ToolDock;
  readonly toolPanelCollapsed: boolean;
  readonly treeDock: TreeDock;
  readonly clearDockDrag: () => void;
  readonly dockEditorPanel: (dock: EditorDock) => void;
  readonly dockProjectPanel: (dock: ProjectDock) => void;
  readonly dockToolPanel: (panel: ToolPanelId, dock: ToolDock) => void;
  readonly endToolPanelDrag: () => void;
  readonly moveGitPanel: (panel: GitPanelId, targetPanel: GitPanelId) => void;
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

  const clearDockDrag = useCallback(() => {
    setDraggedToolPanel(null);
    setDraggedGitPanel(null);
    setDraggingTreePanel(false);
    setDraggingEditorPanel(false);
  }, []);

  useEffect(() => {
    saveWorkbenchLayout({
      activityView,
      toolDock,
      treeDock,
      projectInToolDock,
      gitPanelOrder,
      detachedGitPanels,
      panelSizes,
    });
  }, [
    activityView,
    detachedGitPanels,
    gitPanelOrder,
    panelSizes,
    projectInToolDock,
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
    toolDock,
    toolPanelCollapsed,
    treeDock,
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
  };
}
