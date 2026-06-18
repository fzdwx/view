import { GitBranch } from "lucide-react";
import type { CommitInfo, RepositoryPayload } from "../../lib/api";
import { formatDate } from "../../lib/dateFormat";
import { ResizeHandle } from "../ResizeHandle";
import { TreePanel } from "../TreePanel";
import type { TreeGitFileActions } from "../TreeContextMenu";
import type { GitWriteActions } from "../../hooks/useGitWriteActions";
import { CommitForm } from "./CommitForm";

export function CommitInspector({
  commit,
  branchName,
  detailHeight,
  files,
  gitFileActions,
  gitWriteActions,
  selectedPath,
  onResizeDetails,
  onSelectPath,
}: {
  commit: CommitInfo | null;
  branchName?: string;
  detailHeight: number;
  files: RepositoryPayload["files"];
  gitFileActions?: TreeGitFileActions;
  gitWriteActions: GitWriteActions;
  selectedPath: string | null;
  onResizeDetails(delta: number): void;
  onSelectPath(path: string): void;
}) {
  return (
    <aside
      className="commit-detail-panel"
      style={{
        gridTemplateRows: `minmax(0, 1fr) 6px ${detailHeight}px`,
      }}
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
        axis="y"
        className="commit-info-splitter"
        label="Resize commit details"
        onResize={onResizeDetails}
      />
      <CommitDetails
        branchName={branchName}
        commit={commit}
        files={files}
        gitWriteActions={gitWriteActions}
      />
    </aside>
  );
}

function CommitDetails({
  commit,
  branchName,
  files,
  gitWriteActions,
}: {
  commit: CommitInfo | null;
  branchName?: string;
  files: RepositoryPayload["files"];
  gitWriteActions: GitWriteActions;
}) {
  if (!commit) {
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
}
