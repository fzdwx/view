import type { ReactNode } from "react";
import { gitPanelLabel, isGitPanelId } from "../../lib/workbenchLayout";
import type { ToolPanelId } from "../../lib/workbenchTypes";
import { TerminalPanel } from "../TerminalPanel";
import { GitPanelBody, type GitPanelDataProps } from "./GitPanels";
import { ToolContentFrame } from "./ToolContentFrame";

export interface WorkbenchToolPanelStackProps {
  readonly activeProjectPath: string | null;
  readonly activityView: ToolPanelId;
  readonly gitPanelContent: ReactNode;
  readonly gitPanelData: GitPanelDataProps;
  readonly projectTreeContent: ReactNode;
  readonly onDragEnd: () => void;
  readonly onDragStart: (panel: ToolPanelId) => void;
}

export function WorkbenchToolPanelStack({
  activeProjectPath,
  activityView,
  gitPanelContent,
  gitPanelData,
  projectTreeContent,
  onDragEnd,
  onDragStart,
}: WorkbenchToolPanelStackProps) {
  const nonTerminalToolPanelContent =
    activityView === "project"
      ? projectTreeContent
      : isGitPanelId(activityView)
        ? (
            <ToolContentFrame
              label={gitPanelLabel(activityView)}
              panelId={activityView}
              onDragEnd={onDragEnd}
              onDragStart={onDragStart}
            >
              <section className="detached-git-panel">
                <GitPanelBody panelId={activityView} {...gitPanelData} />
              </section>
            </ToolContentFrame>
          )
        : activityView === "git"
          ? gitPanelContent
          : null;

  return (
    <div className="tool-panel-stack">
      <div
        className={
          activityView === "terminal"
            ? "tool-panel-layer tool-panel-layer-hidden"
            : "tool-panel-layer"
        }
        aria-hidden={activityView === "terminal"}
      >
        {nonTerminalToolPanelContent}
      </div>
      <section
        className={
          activityView === "terminal"
            ? "bottom-terminal-panel tool-panel-layer"
            : "bottom-terminal-panel tool-panel-layer tool-panel-layer-hidden"
        }
        aria-hidden={activityView !== "terminal"}
      >
        <TerminalPanel
          active={activityView === "terminal"}
          projectPath={activeProjectPath}
        />
      </section>
    </div>
  );
}
