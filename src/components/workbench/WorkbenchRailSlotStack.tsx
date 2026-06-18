import type { ReactNode } from "react";
import { TerminalPanel } from "../TerminalPanel";
import { GitPanels, type GitPanelDataProps } from "./GitPanels";
import type {
  GitPanelId,
  PanelSizes,
  RailItemId,
  RailSide,
  RailSlot,
  ToolDock,
} from "../../lib/workbenchTypes";

export interface WorkbenchRailSlotStackProps {
  readonly activeItem: RailItemId | null;
  readonly activeProjectPath: string | null;
  readonly dockedGitPanelOrder: GitPanelId[];
  readonly draggedGitPanel: GitPanelId | null;
  readonly gitPanelData: GitPanelDataProps;
  readonly items: readonly RailItemId[];
  readonly panelSizes: Pick<PanelSizes, "branch" | "details">;
  readonly projectTreeContent: ReactNode;
  readonly side: RailSide;
  readonly slot: RailSlot;
  readonly onDragEnd: () => void;
  readonly onDragStart: (panel: GitPanelId) => void;
  readonly onDropPanel: (panel: GitPanelId, targetPanel: GitPanelId) => void;
  readonly onReattachPanel: (panel: GitPanelId) => void;
  readonly resizePanel: (
    key: keyof PanelSizes,
    delta: number,
    min: number,
    max: number,
  ) => void;
}

export function WorkbenchRailSlotStack({
  activeItem,
  activeProjectPath,
  dockedGitPanelOrder,
  draggedGitPanel,
  gitPanelData,
  items,
  panelSizes,
  projectTreeContent,
  side,
  slot,
  onDragEnd,
  onDragStart,
  onDropPanel,
  onReattachPanel,
  resizePanel,
}: WorkbenchRailSlotStackProps) {
  const dockMode: ToolDock = slot === "bottom" ? "bottom" : side;
  const isBottomSlot = slot === "bottom";

  return (
    <section
      className={`rail-slot-panel rail-slot-panel-${side} rail-slot-panel-${slot} tool-dock-${dockMode}`}
    >
      <div className="tool-panel-stack rail-slot-panel-stack">
        {items.includes("fileTree") ? (
          <div
            className={
              activeItem === "fileTree"
                ? "tool-panel-layer"
                : "tool-panel-layer tool-panel-layer-hidden"
            }
            aria-hidden={activeItem !== "fileTree"}
          >
            {projectTreeContent}
          </div>
        ) : null}
        {items.includes("git") ? (
          <div
            className={
              activeItem === "git"
                ? "tool-panel-layer"
                : "tool-panel-layer tool-panel-layer-hidden"
            }
            aria-hidden={activeItem !== "git"}
          >
            <GitPanels
              data={gitPanelData}
              dockedPanelOrder={dockedGitPanelOrder}
              draggedGitPanel={draggedGitPanel}
              panelSizes={panelSizes}
              toolDock={dockMode}
              onDragEnd={onDragEnd}
              onDragStart={onDragStart}
              onDropPanel={onDropPanel}
              onReattachPanel={onReattachPanel}
              resizePanel={resizePanel}
            />
          </div>
        ) : null}
        {items.includes("terminal") ? (
          <section
            className={
              activeItem === "terminal"
                ? "tool-panel-layer"
                : "tool-panel-layer tool-panel-layer-hidden"
            }
            aria-hidden={activeItem !== "terminal"}
          >
            <div
              className={
                isBottomSlot
                  ? "bottom-terminal-panel"
                  : "bottom-terminal-panel rail-side-terminal-panel"
              }
            >
              <TerminalPanel
                active={activeItem === "terminal"}
                projectPath={activeProjectPath}
              />
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}
