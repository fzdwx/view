import type { DragEvent } from "react";
import { isGitPanelId } from "../../lib/workbenchLayout";
import type {
  EditorDock,
  GitPanelId,
  ProjectDock,
  ToolDock,
  ToolPanelId,
} from "../../lib/workbenchTypes";

export function WorkbenchDockOverlay({
  activeEditorDock,
  activeProjectDock,
  activeToolDock,
  draggedGitPanel,
  draggedToolPanel,
  draggingEditorPanel,
  draggingTreePanel,
  onDockEditor,
  onDockProject,
  onDockTool,
}: {
  activeEditorDock: EditorDock;
  activeProjectDock: ProjectDock;
  activeToolDock: ToolDock;
  draggedGitPanel: GitPanelId | null;
  draggedToolPanel: ToolPanelId | null;
  draggingEditorPanel: boolean;
  draggingTreePanel: boolean;
  onDockEditor(dock: EditorDock): void;
  onDockProject(dock: ProjectDock): void;
  onDockTool(panel: ToolPanelId, dock: ToolDock): void;
}) {
  const draggingTool = Boolean(draggedToolPanel || draggedGitPanel);

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function getDraggedToolPanel(event: DragEvent<HTMLDivElement>) {
    const gitPanel = event.dataTransfer.getData(
      "application/x-view-git-panel",
    ) as GitPanelId;
    if (isGitPanelId(gitPanel)) {
      return gitPanel;
    }

    const toolPanel = event.dataTransfer.getData(
      "application/x-view-tool-panel",
    ) as ToolPanelId;
    if (
      toolPanel === "project" ||
      toolPanel === "git" ||
      toolPanel === "terminal" ||
      isGitPanelId(toolPanel)
    ) {
      return toolPanel;
    }

    return draggedToolPanel ?? draggedGitPanel;
  }

  function handleToolDrop(nextDock: ToolDock) {
    return (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const panel = getDraggedToolPanel(event);
      if (panel) {
        onDockTool(panel, nextDock);
      }
    };
  }

  function handleProjectDrop(nextDock: ProjectDock) {
    return (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      onDockProject(nextDock);
    };
  }

  function handleEditorDrop(nextDock: EditorDock) {
    return (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      onDockEditor(nextDock);
    };
  }

  return (
    <div className="workbench-dock-overlay" aria-hidden="true">
      {draggingTool ? (
        <>
          <DockDropZone
            active={activeToolDock === "left"}
            className="dock-drop-left"
            onDragOver={handleDragOver}
            onDrop={handleToolDrop("left")}
          />
          <DockDropZone
            active={activeToolDock === "bottom"}
            className="dock-drop-bottom"
            onDragOver={handleDragOver}
            onDrop={handleToolDrop("bottom")}
          />
          <DockDropZone
            active={activeToolDock === "right"}
            className="dock-drop-right"
            onDragOver={handleDragOver}
            onDrop={handleToolDrop("right")}
          />
        </>
      ) : null}

      {draggingTreePanel ? (
        <>
          <DockDropZone
            active={activeProjectDock === "left"}
            className="dock-drop-left"
            onDragOver={handleDragOver}
            onDrop={handleProjectDrop("left")}
          />
          <DockDropZone
            active={activeProjectDock === "panel"}
            className="dock-drop-center"
            onDragOver={handleDragOver}
            onDrop={handleProjectDrop("panel")}
          />
          <DockDropZone
            active={activeProjectDock === "right"}
            className="dock-drop-right"
            onDragOver={handleDragOver}
            onDrop={handleProjectDrop("right")}
          />
        </>
      ) : null}

      {draggingEditorPanel ? (
        <>
          <DockDropZone
            active={activeEditorDock === "left"}
            className="dock-drop-left"
            onDragOver={handleDragOver}
            onDrop={handleEditorDrop("left")}
          />
          <DockDropZone
            active={activeEditorDock === "right"}
            className="dock-drop-right"
            onDragOver={handleDragOver}
            onDrop={handleEditorDrop("right")}
          />
        </>
      ) : null}
    </div>
  );
}

function DockDropZone({
  active,
  className,
  onDragOver,
  onDrop,
}: {
  active: boolean;
  className: string;
  onDragOver(event: DragEvent<HTMLDivElement>): void;
  onDrop(event: DragEvent<HTMLDivElement>): void;
}) {
  return (
    <div
      className={
        active ? `dock-drop-zone ${className} active` : `dock-drop-zone ${className}`
      }
      onDragOver={onDragOver}
      onDrop={onDrop}
    />
  );
}
