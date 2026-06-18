import type { CSSProperties, ReactNode } from "react";
import type { BranchInfo, CommitInfo, RepositoryPayload } from "../../lib/api";
import type { BranchActionKind } from "../../lib/branchModels";
import {
  buildGitPanelGridStyle,
  isGitPanelId,
} from "../../lib/workbenchLayout";
import type { GitPanelId, PanelSizes, ToolDock } from "../../lib/workbenchTypes";
import { LoadingRows } from "../LoadingRows";
import { BranchTree } from "../git/BranchTree";
import { CommitInspector } from "../git/CommitInspector";
import { VirtualCommitList } from "../git/VirtualCommitList";
import { FragmentWithSplitter } from "./FragmentWithSplitter";
import { GitPanelSlot } from "./GitPanelSlot";

type ResizePanel = (
  key: keyof PanelSizes,
  delta: number,
  min: number,
  max: number,
) => void;

export interface GitPanelDataProps {
  readonly activeCommit: string | null;
  readonly commitFilter: string;
  readonly commits: CommitInfo[];
  readonly commitsLoading: boolean;
  readonly detailHeight: number;
  readonly filteredCommits: CommitInfo[];
  readonly payload: RepositoryPayload | undefined;
  readonly selectedBranch: BranchInfo | null;
  readonly selectedBranchRef: string | null;
  readonly selectedChangePath: string | null;
  readonly selectedCommit: CommitInfo | null;
  readonly onBranchAction: (
    action: BranchActionKind,
    branch: BranchInfo,
  ) => void;
  readonly onChangeCommitFilter: (filter: string) => void;
  readonly onOpenDiffPath: (path: string) => void;
  readonly onResizeCommitInfo: (delta: number) => void;
  readonly onSelectBranch: (refName: string) => void;
  readonly onSelectCommit: (hash: string) => void;
  readonly onSelectWorkingTree: () => void;
}

export interface GitPanelsProps {
  readonly data: GitPanelDataProps;
  readonly dockedPanelOrder: GitPanelId[];
  readonly draggedGitPanel: GitPanelId | null;
  readonly panelSizes: Pick<PanelSizes, "branch" | "details">;
  readonly toolDock: ToolDock;
  readonly onDragEnd: () => void;
  readonly onDragStart: (panel: GitPanelId) => void;
  readonly onDropPanel: (panel: GitPanelId, targetPanel: GitPanelId) => void;
  readonly onReattachPanel: (panel: GitPanelId) => void;
  readonly resizePanel: ResizePanel;
}

export function GitPanels({
  data,
  dockedPanelOrder,
  draggedGitPanel,
  panelSizes,
  toolDock,
  onDragEnd,
  onDragStart,
  onDropPanel,
  onReattachPanel,
  resizePanel,
}: GitPanelsProps) {
  const gitLogStyle: CSSProperties = buildGitPanelGridStyle(
    toolDock,
    dockedPanelOrder,
    panelSizes.branch,
    panelSizes.details,
  );

  return (
    <section className="git-log-panel" style={gitLogStyle}>
      {dockedPanelOrder.length === 0 ? (
        <EmptyGitPanelDropTarget
          draggedGitPanel={draggedGitPanel}
          onReattachPanel={onReattachPanel}
        />
      ) : null}
      {dockedPanelOrder.map((panelId, index) => (
        <FragmentWithSplitter
          key={panelId}
          index={index}
          panelCount={dockedPanelOrder.length}
          dock={toolDock}
          onResizeFirst={(delta) =>
            resizePanel("branch", delta, toolDock === "bottom" ? 180 : 120, 460)
          }
          onResizeSecond={(delta) =>
            resizePanel("details", -delta, toolDock === "bottom" ? 200 : 120, 460)
          }
        >
          <GitPanelSlot
            panelId={panelId}
            draggingPanel={draggedGitPanel}
            onDropPanel={onDropPanel}
            onDragEnd={onDragEnd}
            onDragStart={onDragStart}
          >
            <GitPanelBody panelId={panelId} {...data} />
          </GitPanelSlot>
        </FragmentWithSplitter>
      ))}
    </section>
  );
}

export function GitPanelBody({
  activeCommit,
  commitFilter,
  commits,
  commitsLoading,
  detailHeight,
  filteredCommits,
  panelId,
  payload,
  selectedBranch,
  selectedBranchRef,
  selectedChangePath,
  selectedCommit,
  onBranchAction,
  onChangeCommitFilter,
  onOpenDiffPath,
  onResizeCommitInfo,
  onSelectBranch,
  onSelectCommit,
  onSelectWorkingTree,
}: GitPanelDataProps & { readonly panelId: GitPanelId }): ReactNode {
  switch (panelId) {
    case "branches":
      return (
        <section className="branch-panel">
          {payload ? (
            <BranchTree
              branches={payload.summary.branches}
              tags={payload.summary.tags}
              activeRef={selectedBranchRef}
              onBranchAction={onBranchAction}
              onSelect={onSelectBranch}
            />
          ) : (
            <LoadingRows />
          )}
        </section>
      );
    case "history":
      return (
        <section className="history-panel">
          <VirtualCommitList
            commits={filteredCommits}
            graphWidthCommits={commits}
            activeCommit={activeCommit}
            branch={selectedBranch}
            filter={commitFilter}
            loading={commitsLoading}
            onChangeFilter={onChangeCommitFilter}
            onSelectCommit={onSelectCommit}
            onSelectWorkingTree={onSelectWorkingTree}
          />
        </section>
      );
    case "details":
      return (
        <CommitInspector
          branchName={selectedGitRefName(payload, selectedBranchRef)}
          commit={selectedCommit}
          files={payload?.files ?? []}
          detailHeight={detailHeight}
          selectedPath={selectedChangePath}
          onResizeDetails={onResizeCommitInfo}
          onSelectPath={onOpenDiffPath}
        />
      );
    default: {
      const exhaustivePanelId: never = panelId;
      return exhaustivePanelId;
    }
  }
}

function EmptyGitPanelDropTarget({
  draggedGitPanel,
  onReattachPanel,
}: {
  readonly draggedGitPanel: GitPanelId | null;
  readonly onReattachPanel: (panel: GitPanelId) => void;
}) {
  return (
    <div
      className={draggedGitPanel ? "git-panel-empty can-drop" : "git-panel-empty"}
      onDragOver={(event) => {
        if (!draggedGitPanel) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        const panel = event.dataTransfer.getData("application/x-view-git-panel");
        if (isGitPanelId(panel)) {
          onReattachPanel(panel);
          return;
        }
        if (draggedGitPanel) {
          onReattachPanel(draggedGitPanel);
        }
      }}
    >
      All Git panels are docked as tabs.
    </div>
  );
}

function selectedGitRefName(
  payload: RepositoryPayload | undefined,
  selectedBranchRef: string | null,
): string | undefined {
  if (!payload) {
    return undefined;
  }

  return (
    payload.summary.branches.find(
      (branch) => branch.refName === selectedBranchRef,
    )?.name ??
    payload.summary.tags.find((tag) => tag.refName === selectedBranchRef)?.name ??
    payload.summary.branch
  );
}
