import type { DragEvent, ReactNode } from "react";
import { gitPanelLabel } from "../../lib/workbenchLayout";
import type { GitPanelId } from "../../lib/workbenchTypes";

export function GitPanelSlot({
  children,
  draggingPanel,
  onDragEnd,
  onDragStart,
  onDropPanel,
  panelId,
}: {
  children: ReactNode;
  draggingPanel: GitPanelId | null;
  onDragEnd(): void;
  onDragStart(panel: GitPanelId): void;
  onDropPanel(panel: GitPanelId, targetPanel: GitPanelId): void;
  panelId: GitPanelId;
}) {
  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (!draggingPanel) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const panel =
      (event.dataTransfer.getData("application/x-view-git-panel") as GitPanelId) ||
      draggingPanel;
    if (panel === "branches" || panel === "history" || panel === "details") {
      onDropPanel(panel, panelId);
    }
  }

  return (
    <section
      className={
        draggingPanel && draggingPanel !== panelId
          ? "git-panel-slot can-drop"
          : "git-panel-slot"
      }
      style={{ gridArea: panelId }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div
        className="git-panel-grab-edge"
        draggable
        title={`Drag ${gitPanelLabel(panelId)} panel`}
        onDragEnd={onDragEnd}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-view-git-panel", panelId);
          onDragStart(panelId);
        }}
      />
      <div className="git-panel-slot-body">{children}</div>
    </section>
  );
}
