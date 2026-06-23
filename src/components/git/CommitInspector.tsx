import { memo, useCallback, useMemo, useState } from "react";
import { GitBranch, RotateCcw } from "lucide-react";
import type { CommitInfo, ReflogEntry, RepositoryPayload } from "../../lib/api";
import { formatDate } from "../../lib/dateFormat";
import { clamp } from "../../lib/numeric";
import { ResizeHandle } from "../ResizeHandle";
import { TreePanel } from "../TreePanel";
import type { TreeGitFileActions } from "../TreeContextMenu";
import type { GitWriteActions } from "../../hooks/useGitWriteActions";
import { CommitForm } from "./CommitForm";

const minCommitDetailHeight = 110;
const maxCommitDetailHeight = 360;

export function CommitInspector({
  commit,
  branchName,
  detailHeight,
  files,
  gitFileActions,
  gitWriteActions,
  historyMode = "commits",
  orientation = "vertical",
  selectedReflogEntry = null,
  selectedPath,
  showCommitForm = false,
  onResizeDetails,
  onSelectPath,
}: {
  commit: CommitInfo | null;
  branchName?: string;
  detailHeight: number;
  files: RepositoryPayload["files"];
  gitFileActions?: TreeGitFileActions;
  gitWriteActions: GitWriteActions;
  historyMode?: "commits" | "reflog";
  orientation?: "vertical" | "horizontal";
  selectedReflogEntry?: ReflogEntry | null;
  selectedPath: string | null;
  showCommitForm?: boolean;
  onResizeDetails(delta: number): void;
  onSelectPath(path: string): void;
}) {
  const [draftDetail, setDraftDetail] = useState<{
    forDetail: number;
    value: number;
  } | null>(null);
  const isHorizontal = orientation === "horizontal";
  const effectiveDetailHeight =
    draftDetail?.forDetail === detailHeight ? draftDetail.value : detailHeight;
  const panelStyle = useMemo(
    () =>
      isHorizontal
        ? { gridTemplateColumns: `minmax(0, 1fr) 6px ${effectiveDetailHeight}px` }
        : { gridTemplateRows: `minmax(0, 1fr) 6px ${effectiveDetailHeight}px` },
    [effectiveDetailHeight, isHorizontal],
  );
  const handleResizePreview = useCallback(
    (delta: number) => {
      setDraftDetail((current) => {
        const base =
          current?.forDetail === detailHeight ? current.value : detailHeight;
        return {
          forDetail: detailHeight,
          value: clamp(base + delta, minCommitDetailHeight, maxCommitDetailHeight),
        };
      });
    },
    [detailHeight],
  );
  const handleResizeCommit = useCallback(
    (totalDelta: number) => {
      if (totalDelta === 0) {
        return;
      }

      onResizeDetails(totalDelta);
      setDraftDetail(null);
    },
    [onResizeDetails],
  );

  return (
    <aside
      className={`commit-detail-panel${isHorizontal ? " commit-detail-panel-horizontal" : ""}`}
      style={panelStyle}
    >
      <div className="commit-changes-panel">
        <TreePanel
          files={files}
          selectedPath={selectedPath}
          title="Changes"
          showHeader={false}
          initialExpansion="open"
          emptyTitle="No changed files"
          emptyCopy="Select a commit with file changes, or inspect working tree changes."
          gitFileActions={commit ? undefined : gitFileActions}
          onSelectPath={onSelectPath}
        />
      </div>
      <ResizeHandle
        axis={isHorizontal ? "x" : "y"}
        className="commit-info-splitter"
        label="Resize commit details"
        onResize={handleResizePreview}
        onResizeEnd={handleResizeCommit}
      />
      <CommitDetails
        branchName={branchName}
        commit={commit}
        files={files}
        gitFileActions={gitFileActions}
        gitWriteActions={gitWriteActions}
        historyMode={historyMode}
        selectedReflogEntry={selectedReflogEntry}
        showCommitForm={showCommitForm}
      />
    </aside>
  );
}

const CommitDetails = memo(function CommitDetails({
  commit,
  branchName,
  files,
  gitFileActions,
  gitWriteActions,
  historyMode,
  selectedReflogEntry,
  showCommitForm,
}: {
  commit: CommitInfo | null;
  branchName?: string;
  files: RepositoryPayload["files"];
  gitFileActions?: TreeGitFileActions;
  gitWriteActions: GitWriteActions;
  historyMode: "commits" | "reflog";
  selectedReflogEntry: ReflogEntry | null;
  showCommitForm: boolean;
}) {
  if (!commit) {
    if (!showCommitForm) {
      return null;
    }

    return (
      <section className="commit-details-section">
        <CommitForm
          branchName={branchName}
          files={files}
          gitFileActions={gitFileActions}
          gitWriteActions={gitWriteActions}
        />
      </section>
    );
  }

  const fileCount = files.length;
  const showReflogRestore =
    historyMode === "reflog" && selectedReflogEntry !== null;

  return (
    <section className="commit-details-section">
      <div className="commit-detail-body">
        <div className="commit-detail-heading">
          <span className="commit-detail-subject">{commit.subject}</span>
          <span className="commit-detail-hash mono-value">{commit.shortHash}</span>
        </div>
        <div className="commit-detail-meta">
          <span>{commit.author}</span>
          <span>{formatDate(commit.date)}</span>
        </div>
        {showReflogRestore && selectedReflogEntry ? (
          <div className="commit-detail-line">
            <RotateCcw size={13} />
            <span className="commit-reflog-meta">
              <span className="compact-detail-pill mono-value">
                {selectedReflogEntry.selector}
              </span>
              <span>{selectedReflogEntry.action}</span>
            </span>
          </div>
        ) : (
          <div className="commit-detail-line">
            <GitBranch size={13} />
            <span>
              In 1 branch: <strong>{branchName ?? "current"}</strong>
            </span>
          </div>
        )}
        <div className="commit-detail-line muted">
          <span>{fileCount} changed {fileCount === 1 ? "file" : "files"}</span>
        </div>
      </div>
    </section>
  );
});

CommitDetails.displayName = "CommitDetails";
