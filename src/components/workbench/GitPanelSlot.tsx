import { useEffect, useState, type DragEvent, type ReactNode } from "react";
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
  const [dropActive, setDropActive] = useState(false);
  const canDrop = draggingPanel !== null && draggingPanel !== panelId;

  useEffect(() => {
    if (!canDrop) {
      setDropActive(false);
    }
  }, [canDrop]);

  function handleDragEnter(event: DragEvent<HTMLElement>) {
    if (!canDrop) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropActive(true);
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (!canDrop) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    const relatedTarget = event.relatedTarget;
    if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) {
      setDropActive(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDropActive(false);
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
        [
          "git-panel-slot",
          canDrop ? "can-drop" : "",
          canDrop && dropActive ? "drop-target-active" : "",
        ]
          .filter(Boolean)
          .join(" ")
      }
      style={{ gridArea: panelId }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
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
