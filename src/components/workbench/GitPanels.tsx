import {
  memo,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import type {
  BranchInfo,
  CommitInfo,
  ReflogEntry,
  RepositoryPayload,
} from "../../lib/api";
import type { WorktreeActions } from "../../hooks/useWorktreeActions";
import type { StashActions } from "../../hooks/useStashActions";
import type { TagActions } from "../../hooks/useTagActions";
import type { RemoteActions } from "../../hooks/useRemoteActions";
import type { BranchActionKind } from "../../lib/branchModels";
import type { GitWriteActions } from "../../hooks/useGitWriteActions";
import {
  buildGitPanelGridStyle,
  isGitPanelId,
} from "../../lib/workbenchLayout";
import { clamp } from "../../lib/numeric";
import type { GitPanelId, PanelSizes, ToolDock } from "../../lib/workbenchTypes";
import { LoadingRows } from "../LoadingRows";
import type { TreeGitFileActions } from "../TreeContextMenu";
import { BranchTree } from "../git/BranchTree";
import { CommitInspector } from "../git/CommitInspector";
import { StashList } from "../git/StashList";
import { RemoteManager } from "../git/RemoteManager";
import { VirtualCommitList } from "../git/VirtualCommitList";
import { WorktreeList } from "../git/WorktreeList";
import { FragmentWithSplitter } from "./FragmentWithSplitter";
import { GitPanelSlot } from "./GitPanelSlot";

type ResizePanel = (
  key: keyof PanelSizes,
  delta: number,
  min: number,
  max: number,
) => void;

export type GitAvailability = "loading" | "git" | "non-git";

export interface GitPanelDataProps {
  readonly activeCommit: string | null;
  readonly activeProjectPath: string | null;
  readonly activeReflogSelector: string | null;
  readonly changedFiles: RepositoryPayload["files"];
  readonly commitFiles: RepositoryPayload["files"];
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
  readonly remoteActions: RemoteActions;
  readonly selectedBranch: BranchInfo | null;
  readonly selectedBranchRef: string | null;
  readonly selectedChangePath: string | null;
  readonly selectedCommit: CommitInfo | null;
  readonly selectedReflogEntry: ReflogEntry | null;
  readonly stashActions: StashActions;
  readonly tagActions: TagActions;
  readonly worktreeActions: WorktreeActions;
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
  readonly availability: GitAvailability;
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
  availability,
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
  const branchMin = toolDock === "bottom" ? 180 : 120;
  const detailsMin = toolDock === "bottom" ? 200 : 120;
  const panelRef = useRef<HTMLElement | null>(null);
  const panelSizesRef = useRef({
    branch: branchSize,
    details: detailsSize,
  });
  const previewSizesRef = useRef<Partial<Record<GitPanelSizeVarKey, number>>>({});
  panelSizesRef.current.branch = branchSize;
  panelSizesRef.current.details = detailsSize;

  useLayoutEffect(() => {
    syncGitPanelSizeVars(panelRef.current, branchSize, detailsSize);
  }, [branchSize, detailsSize]);

  const handleResizeBranchPreview = useCallback(
    (delta: number) => {
      const currentSize =
        previewSizesRef.current.branch ?? panelSizesRef.current.branch;
      const nextSize = clamp(currentSize + delta, branchMin, 460);
      if (nextSize === currentSize) {
        return;
      }

      previewSizesRef.current.branch = nextSize;
      applyGitPanelSizeVar(panelRef.current, "branch", nextSize);
    },
    [branchMin],
  );
  const handleResizeBranchCommit = useCallback(
    (totalDelta: number) => {
      const previewSize = previewSizesRef.current.branch;
      delete previewSizesRef.current.branch;

      const baseSize = panelSizesRef.current.branch;
      const nextSize =
        typeof previewSize === "number"
          ? previewSize
          : clamp(baseSize + totalDelta, branchMin, 460);
      const delta = nextSize - baseSize;

      applyGitPanelSizeVar(panelRef.current, "branch", nextSize);
      if (delta !== 0) {
        panelSizesRef.current.branch = nextSize;
        resizePanel("branch", delta, branchMin, 460);
      }
    },
    [branchMin, resizePanel],
  );
  const handleResizeDetailsPreview = useCallback(
    (delta: number) => {
      const currentSize =
        previewSizesRef.current.details ?? panelSizesRef.current.details;
      const nextSize = clamp(currentSize - delta, detailsMin, 460);
      if (nextSize === currentSize) {
        return;
      }

      previewSizesRef.current.details = nextSize;
      applyGitPanelSizeVar(panelRef.current, "details", nextSize);
    },
    [detailsMin],
  );
  const handleResizeDetailsCommit = useCallback(
    (totalDelta: number) => {
      const previewSize = previewSizesRef.current.details;
      delete previewSizesRef.current.details;

      const baseSize = panelSizesRef.current.details;
      const nextSize =
        typeof previewSize === "number"
          ? previewSize
          : clamp(baseSize - totalDelta, detailsMin, 460);
      const delta = nextSize - baseSize;

      applyGitPanelSizeVar(panelRef.current, "details", nextSize);
      if (delta !== 0) {
        panelSizesRef.current.details = nextSize;
        resizePanel("details", delta, detailsMin, 460);
      }
    },
    [detailsMin, resizePanel],
  );

  const gitLogStyle = useMemo(
    () =>
      buildGitPanelGridStyle(
        toolDock,
        dockedPanelOrder,
        branchSize,
        detailsSize,
      ),
    [branchSize, detailsSize, dockedPanelOrder, toolDock],
  );

  if (availability === "loading") {
    return (
      <section className="git-log-panel" style={buildGitPanelGridStyle(toolDock, [], branchSize, detailsSize)}>
        <LoadingRows />
      </section>
    );
  }

  if (availability === "non-git") {
    return (
      <section className="git-log-panel" style={buildGitPanelGridStyle(toolDock, [], branchSize, detailsSize)}>
        <div className="empty-state">
          <div className="empty-title">Git Features Unavailable</div>
          <div className="empty-copy">
            This folder is not inside a Git repository.
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="git-log-panel" ref={panelRef} style={gitLogStyle}>
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
          onResizeFirst={handleResizeBranchPreview}
          onResizeFirstEnd={handleResizeBranchCommit}
          onResizeSecond={handleResizeDetailsPreview}
          onResizeSecondEnd={handleResizeDetailsCommit}
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

type GitPanelSizeVarKey = "branch" | "details";

function syncGitPanelSizeVars(
  element: HTMLElement | null,
  branchSize: number,
  detailsSize: number,
): void {
  if (!element) {
    return;
  }

  applyGitPanelSizeVar(element, "branch", branchSize);
  applyGitPanelSizeVar(element, "details", detailsSize);
}

function applyGitPanelSizeVar(
  element: HTMLElement | null,
  key: GitPanelSizeVarKey,
  value: number,
): void {
  if (!element) {
    return;
  }

  element.style.setProperty(gitPanelSizeVarName(key), `${value}px`);
}

function gitPanelSizeVarName(key: GitPanelSizeVarKey): string {
  switch (key) {
    case "branch":
      return "--git-panel-first-size";
    case "details":
      return "--git-panel-last-size";
  }
}

export const GitPanelBody = memo(function GitPanelBody({
  activeCommit,
  activeProjectPath,
  activeReflogSelector,
  changedFiles,
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
  remoteActions,
  selectedBranch,
  selectedBranchRef,
  selectedChangePath,
  selectedCommit,
  selectedReflogEntry,
  stashActions,
  tagActions,
  worktreeActions,
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
            <div className="branch-panel-content">
              <div className="repository-section-label">State</div>
              <WorktreeList
                actions={worktreeActions}
                activePath={activeProjectPath}
                sourceBranch={selectedBranch ?? currentBranch(payload)}
                worktrees={payload.summary.worktrees}
              />
              <StashList actions={stashActions} />
              <section className="repository-refs-panel" aria-label="Repository refs">
                <div className="repository-section-label">Refs</div>
                <RemoteManager actions={remoteActions} />
                <BranchTree
                  branches={payload.summary.branches}
                  tags={payload.summary.tags}
                  tagActions={tagActions}
                  tagTargetRef={selectedCommit?.hash ?? selectedBranchRef}
                  activeRef={selectedBranchRef}
                  onBranchAction={onBranchAction}
                  onSelect={onSelectBranch}
                />
              </section>
            </div>
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
          files={changedFiles}
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

function currentBranch(payload: RepositoryPayload): BranchInfo | null {
  return payload.summary.branches.find((branch) => branch.current) ?? null;
}
