import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { GitBranch } from "lucide-react";
import type { CommitInfo, RepositoryPayload } from "../../lib/api";
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
  orientation = "vertical",
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
  orientation?: "vertical" | "horizontal";
  selectedPath: string | null;
  showCommitForm?: boolean;
  onResizeDetails(delta: number): void;
  onSelectPath(path: string): void;
}) {
  const [draftDetailHeight, setDraftDetailHeight] = useState<number | null>(null);
  const isHorizontal = orientation === "horizontal";
  const effectiveDetailHeight = draftDetailHeight ?? detailHeight;
  const panelStyle = useMemo(
    () =>
      isHorizontal
        ? { gridTemplateColumns: `minmax(0, 1fr) 6px ${effectiveDetailHeight}px` }
        : { gridTemplateRows: `minmax(0, 1fr) 6px ${effectiveDetailHeight}px` },
    [effectiveDetailHeight, isHorizontal],
  );
  const handleResizePreview = useCallback(
    (delta: number) => {
      setDraftDetailHeight((current) =>
        clamp(
          (current ?? detailHeight) + delta,
          minCommitDetailHeight,
          maxCommitDetailHeight,
        ),
      );
    },
    [detailHeight],
  );
  const handleResizeCommit = useCallback(
    (totalDelta: number) => {
      if (totalDelta === 0) {
        return;
      }

      onResizeDetails(totalDelta);
      setDraftDetailHeight(null);
    },
    [onResizeDetails],
  );

  useEffect(() => {
    setDraftDetailHeight(null);
  }, [detailHeight]);

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
        gitWriteActions={gitWriteActions}
        showCommitForm={showCommitForm}
      />
    </aside>
  );
}

const CommitDetails = memo(function CommitDetails({
  commit,
  branchName,
  files,
  gitWriteActions,
  showCommitForm,
}: {
  commit: CommitInfo | null;
  branchName?: string;
  files: RepositoryPayload["files"];
  gitWriteActions: GitWriteActions;
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
          gitWriteActions={gitWriteActions}
        />
      </section>
    );
  }

  const fileCount = files.length;

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
        <div className="commit-detail-line">
          <GitBranch size={13} />
          <span>
            In 1 branch: <strong>{branchName ?? "current"}</strong>
          </span>
        </div>
        <div className="commit-detail-line muted">
          <span>{fileCount} changed {fileCount === 1 ? "file" : "files"}</span>
        </div>
      </div>
    </section>
  );
});

CommitDetails.displayName = "CommitDetails";
