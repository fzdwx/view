import type { ReactNode } from "react";
import { isGitPanelId } from "../../lib/workbenchLayout";
import type { ToolPanelId } from "../../lib/workbenchTypes";

export function ToolContentFrame({
  children,
  label,
  panelId,
  onDragEnd,
  onDragStart,
}: {
  children: ReactNode;
  label: string;
  panelId: ToolPanelId;
  onDragEnd(): void;
  onDragStart(panel: ToolPanelId): void;
}) {
  return (
    <section className="tool-content-frame">
      <div
        className="tool-content-dragbar"
        draggable
        title={`Drag ${label} panel`}
        onDragEnd={onDragEnd}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-view-tool-panel", panelId);
          if (isGitPanelId(panelId)) {
            event.dataTransfer.setData("application/x-view-git-panel", panelId);
          }
          onDragStart(panelId);
        }}
      >
        <span>{label}</span>
      </div>
      <div className="tool-content-frame-body">{children}</div>
    </section>
  );
}
