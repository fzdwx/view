import { memo, type CSSProperties, type ReactNode } from "react";
import type {
  BranchInfo,
  CommitInfo,
  ReflogEntry,
  RepositoryPayload,
} from "../../lib/api";
import type { BranchActionKind } from "../../lib/branchModels";
import type { GitWriteActions } from "../../hooks/useGitWriteActions";
import {
  buildGitPanelGridStyle,
  isGitPanelId,
} from "../../lib/workbenchLayout";
import type { GitPanelId, PanelSizes, ToolDock } from "../../lib/workbenchTypes";
import { LoadingRows } from "../LoadingRows";
import type { TreeGitFileActions } from "../TreeContextMenu";
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
  readonly activeReflogSelector: string | null;
  readonly commitFilter: string;
  readonly commits: CommitInfo[];
  readonly commitsLoading: boolean;
  readonly filteredCommits: CommitInfo[];
  readonly gitFileActions?: TreeGitFileActions;
  readonly historyMode: "commits" | "reflog";
  readonly gitWriteActions: GitWriteActions;
  readonly payload: RepositoryPayload | undefined;
  readonly reflogEntries: ReflogEntry[];
  readonly reflogFilter: string;
  readonly reflogLoading: boolean;
  readonly selectedBranch: BranchInfo | null;
  readonly selectedBranchRef: string | null;
  readonly selectedChangePath: string | null;
  readonly selectedCommit: CommitInfo | null;
  readonly selectedReflogEntry: ReflogEntry | null;
  readonly onBranchAction: (
    action: BranchActionKind,
    branch: BranchInfo,
  ) => void;
  readonly onChangeCommitFilter: (filter: string) => void;
  readonly onChangeHistoryMode: (mode: "commits" | "reflog") => void;
  readonly onChangeReflogFilter: (filter: string) => void;
  readonly onOpenDiffPath: (path: string) => void;
  readonly onResizeCommitInfo: (delta: number) => void;
  readonly onSelectBranch: (refName: string) => void;
  readonly onSelectCommit: (hash: string) => void;
  readonly onSelectReflogEntry: (entry: ReflogEntry) => void;
  readonly onSelectWorkingTree: () => void;
  readonly onRestoreReflogEntry: (selector: string) => void | Promise<void>;
}

export interface GitPanelsProps {
  readonly branchSize: number;
  readonly commitDetailSize: number;
  readonly data: GitPanelDataProps;
  readonly detailsSize: number;
  readonly dockedPanelOrder: GitPanelId[];
  readonly draggedGitPanel: GitPanelId | null;
  readonly toolDock: ToolDock;
  readonly onDragEnd: () => void;
  readonly onDragStart: (panel: GitPanelId) => void;
  readonly onDropPanel: (panel: GitPanelId, targetPanel: GitPanelId) => void;
  readonly onReattachPanel: (panel: GitPanelId) => void;
  readonly resizePanel: ResizePanel;
}

export const GitPanels = memo(function GitPanels({
  branchSize,
  commitDetailSize,
  data,
  detailsSize,
  dockedPanelOrder,
  draggedGitPanel,
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
    branchSize,
    detailsSize,
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
            <GitPanelBody
              commitDetailSize={commitDetailSize}
              panelId={panelId}
              {...data}
            />
          </GitPanelSlot>
        </FragmentWithSplitter>
      ))}
    </section>
  );
});

GitPanels.displayName = "GitPanels";

export const GitPanelBody = memo(function GitPanelBody({
  activeCommit,
  activeReflogSelector,
  commitFilter,
  commits,
  commitsLoading,
  filteredCommits,
  gitFileActions,
  historyMode,
  gitWriteActions,
  panelId,
  payload,
  reflogEntries,
  reflogFilter,
  reflogLoading,
  selectedBranch,
  selectedBranchRef,
  selectedChangePath,
  selectedCommit,
  selectedReflogEntry,
  onBranchAction,
  onChangeCommitFilter,
  onChangeHistoryMode,
  onChangeReflogFilter,
  onOpenDiffPath,
  onResizeCommitInfo,
  onSelectBranch,
  onSelectCommit,
  onSelectReflogEntry,
  onSelectWorkingTree,
  onRestoreReflogEntry,
  commitDetailSize,
}: GitPanelDataProps & {
  readonly panelId: GitPanelId;
  readonly commitDetailSize?: number;
}): ReactNode {
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
            activeReflogSelector={activeReflogSelector}
            branch={selectedBranch}
            filter={commitFilter}
            gitWriteActions={gitWriteActions}
            historyMode={historyMode}
            loading={commitsLoading}
            onChangeFilter={onChangeCommitFilter}
            onChangeHistoryMode={onChangeHistoryMode}
            onChangeReflogFilter={onChangeReflogFilter}
            reflogEntries={reflogEntries}
            reflogFilter={reflogFilter}
            reflogLoading={reflogLoading}
            onSelectCommit={onSelectCommit}
            onSelectReflogEntry={onSelectReflogEntry}
            onRestoreReflogEntry={onRestoreReflogEntry}
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
          gitFileActions={gitFileActions}
          gitWriteActions={gitWriteActions}
          historyMode={historyMode}
          detailHeight={commitDetailSize ?? 154}
          selectedReflogEntry={selectedReflogEntry}
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
});

GitPanelBody.displayName = "GitPanelBody";

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

// Pure helper co-located with the component for its callers; Fast Refresh is
// not a concern for this non-component export.
// oxlint-disable-next-line react-doctor/only-export-components
export function selectedGitRefName(
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
