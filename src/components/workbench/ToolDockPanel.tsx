import type { ReactNode } from "react";
import { isGitPanelId } from "../../lib/workbenchLayout";
import type { ToolDock, ToolPanelId } from "../../lib/workbenchTypes";
import type { ToolDockPanelDefinition } from "./toolPanels";

export function ToolDockPanel({
  activeView,
  children,
  collapsed,
  dock,
  panels,
  onDragEnd,
  onDragStart,
  onSelectView,
}: {
  activeView: ToolPanelId;
  children: ReactNode;
  collapsed: boolean;
  dock: ToolDock;
  panels: ToolDockPanelDefinition[];
  onDragEnd(): void;
  onDragStart(panel: ToolPanelId): void;
  onSelectView(view: ToolPanelId): void;
}) {
  const hasTabs = panels.length > 0;
  const sectionClass = collapsed
    ? `tool-dock-panel tool-dock-${dock} collapsed${hasTabs ? "" : " no-tabs"}`
    : `tool-dock-panel tool-dock-${dock}${hasTabs ? "" : " no-tabs"}`;

  return (
    <section className={sectionClass}>
      <div className="tool-dock-content" aria-hidden={collapsed}>
        {children}
      </div>
      {hasTabs ? (
        <nav className="tool-dock-tabs" aria-label="Tool panel views">
          <div className="tool-tab-group">
            {panels.map((panel) => {
              const Icon = panel.icon;
              return (
                <button
                  key={panel.id}
                  className={
                    activeView === panel.id
                      ? "activity-button active"
                      : "activity-button"
                  }
                  aria-label={`${panel.label} view`}
                  title={`${panel.label}, drag to dock`}
                  draggable
                  onClick={() => onSelectView(panel.id)}
                  onDragEnd={onDragEnd}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData(
                      "application/x-view-tool-panel",
                      panel.id,
                    );
                    if (isGitPanelId(panel.id)) {
                      event.dataTransfer.setData(
                        "application/x-view-git-panel",
                        panel.id,
                      );
                    }
                    onDragStart(panel.id);
                  }}
                >
                  <Icon size={19} />
                </button>
              );
            })}
          </div>
        </nav>
      ) : null}
    </section>
  );
}
