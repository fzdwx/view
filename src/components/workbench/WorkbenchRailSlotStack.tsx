import type { ReactNode } from "react";
import { CommitInspector } from "../git/CommitInspector";
import { TerminalPanel } from "../TerminalPanel";
import {
  GitPanels,
  selectedGitRefName,
  type GitPanelDataProps,
} from "./GitPanels";
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
  readonly branchSize: number;
  readonly detailsSize: number;
  readonly dockedGitPanelOrder: GitPanelId[];
  readonly draggedGitPanel: GitPanelId | null;
  readonly gitPanelData: GitPanelDataProps;
  readonly items: readonly RailItemId[];
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
  branchSize,
  detailsSize,
  dockedGitPanelOrder,
  draggedGitPanel,
  gitPanelData,
  items,
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
              branchSize={branchSize}
              data={gitPanelData}
              detailsSize={detailsSize}
              dockedPanelOrder={dockedGitPanelOrder}
              draggedGitPanel={draggedGitPanel}
              toolDock={dockMode}
              onDragEnd={onDragEnd}
              onDragStart={onDragStart}
              onDropPanel={onDropPanel}
              onReattachPanel={onReattachPanel}
              resizePanel={resizePanel}
            />
          </div>
        ) : null}
        {items.includes("commit") ? (
          <div
            className={
              activeItem === "commit"
                ? "tool-panel-layer rail-commit-panel"
                : "tool-panel-layer tool-panel-layer-hidden"
            }
            aria-hidden={activeItem !== "commit"}
          >
            <CommitInspector
              commit={null}
              orientation={isBottomSlot ? "horizontal" : "vertical"}
              branchName={selectedGitRefName(
                gitPanelData.payload,
                gitPanelData.selectedBranchRef,
              )}
              detailHeight={gitPanelData.detailHeight}
              files={gitPanelData.payload?.files ?? []}
              gitFileActions={gitPanelData.gitFileActions}
              gitWriteActions={gitPanelData.gitWriteActions}
              selectedPath={gitPanelData.selectedChangePath}
              onResizeDetails={gitPanelData.onResizeCommitInfo}
              onSelectPath={gitPanelData.onOpenDiffPath}
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
