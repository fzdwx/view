import { isValidElement, memo, type ReactNode } from "react";
import { CommitInspector } from "../git/CommitInspector";
import { RunPanel } from "../RunPanel";
import { TerminalPanel } from "../TerminalPanel";
import {
  GitPanels,
  selectedGitRefName,
  type GitAvailability,
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
  readonly gitAvailability: GitAvailability;
  readonly branchSize: number;
  readonly commitDetailSize: number;
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

export const WorkbenchRailSlotStack = memo(
  function WorkbenchRailSlotStack({
    activeItem,
    activeProjectPath,
    gitAvailability,
    branchSize,
    commitDetailSize,
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
                availability={gitAvailability}
                branchSize={branchSize}
                commitDetailSize={commitDetailSize}
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
              {gitAvailability === "loading" ? (
                <div className="diff-loading">Loading Git status…</div>
              ) : gitAvailability === "non-git" ? (
                <ToolPanelEmptyState
                  title="Commit Unavailable"
                  copy="Open a Git repository to stage files and create commits."
                />
              ) : (
                <CommitInspector
                  commit={null}
                  projectPath={activeProjectPath}
                  orientation={isBottomSlot ? "horizontal" : "vertical"}
                  showCommitForm
                  branchName={selectedGitRefName(
                    gitPanelData.payload,
                    gitPanelData.selectedBranchRef,
                  )}
                  detailHeight={commitDetailSize}
                  files={gitPanelData.commitFiles}
                  gitFileActions={gitPanelData.gitFileActions}
                  gitWriteActions={gitPanelData.gitWriteActions}
                  selectedPath={gitPanelData.selectedChangePath}
                  onResizeDetails={gitPanelData.onResizeCommitInfo}
                  onSelectPath={gitPanelData.onOpenDiffPath}
                />
              )}
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
          {items.includes("run") ? (
            <section
              className={
                activeItem === "run"
                  ? "tool-panel-layer"
                  : "tool-panel-layer tool-panel-layer-hidden"
              }
              aria-hidden={activeItem !== "run"}
            >
              <div
                className={
                  isBottomSlot
                    ? "bottom-run-panel"
                    : "bottom-run-panel rail-side-terminal-panel"
                }
              >
                <RunPanel
                  active={activeItem === "run"}
                  projectPath={activeProjectPath}
                />
              </div>
            </section>
          ) : null}
        </div>
      </section>
    );
  },
  areWorkbenchRailSlotStackPropsEqual,
);

WorkbenchRailSlotStack.displayName = "WorkbenchRailSlotStack";

function areWorkbenchRailSlotStackPropsEqual(
  previous: WorkbenchRailSlotStackProps,
  next: WorkbenchRailSlotStackProps,
): boolean {
  return (
    previous.activeItem === next.activeItem &&
    previous.activeProjectPath === next.activeProjectPath &&
    previous.gitAvailability === next.gitAvailability &&
    previous.branchSize === next.branchSize &&
    previous.commitDetailSize === next.commitDetailSize &&
    previous.detailsSize === next.detailsSize &&
    previous.dockedGitPanelOrder === next.dockedGitPanelOrder &&
    previous.draggedGitPanel === next.draggedGitPanel &&
    previous.gitPanelData === next.gitPanelData &&
    previous.items === next.items &&
    previous.side === next.side &&
    previous.slot === next.slot &&
    previous.onDragEnd === next.onDragEnd &&
    previous.onDragStart === next.onDragStart &&
    previous.onDropPanel === next.onDropPanel &&
    previous.onReattachPanel === next.onReattachPanel &&
    previous.resizePanel === next.resizePanel &&
    reactNodeShallowEqual(previous.projectTreeContent, next.projectTreeContent)
  );
}

function reactNodeShallowEqual(
  previous: ReactNode,
  next: ReactNode,
): boolean {
  if (previous === next) {
    return true;
  }
  if (!isValidElement(previous) || !isValidElement(next)) {
    return false;
  }
  if (previous.type !== next.type || previous.key !== next.key) {
    return false;
  }

  return shallowRecordEqual(
    previous.props as Record<string, unknown>,
    next.props as Record<string, unknown>,
  );
}

function shallowRecordEqual(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): boolean {
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  if (previousKeys.length !== nextKeys.length) {
    return false;
  }

  return previousKeys.every((key) => Object.is(previous[key], next[key]));
}

function ToolPanelEmptyState({
  title,
  copy,
}: {
  readonly title: string;
  readonly copy: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-title">{title}</div>
      <div className="empty-copy">{copy}</div>
    </div>
  );
}
