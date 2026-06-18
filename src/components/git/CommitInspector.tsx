import { GitBranch } from "lucide-react";
import type { CommitInfo, RepositoryPayload } from "../../lib/api";
import { formatDate } from "../../lib/dateFormat";
import { ResizeHandle } from "../ResizeHandle";
import { TreePanel } from "../TreePanel";

export function CommitInspector({
  commit,
  branchName,
  detailHeight,
  files,
  selectedPath,
  onResizeDetails,
  onSelectPath,
}: {
  commit: CommitInfo | null;
  branchName?: string;
  detailHeight: number;
  files: RepositoryPayload["files"];
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
        fileCount={files.length}
      />
    </aside>
  );
}

function CommitDetails({
  commit,
  branchName,
  fileCount,
}: {
  commit: CommitInfo | null;
  branchName?: string;
  fileCount: number;
}) {
  return (
    <section className="commit-details-section">
      {commit ? (
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
      ) : (
        <div className="commit-detail-body">
          <div className="commit-detail-heading">
            <span className="commit-detail-subject">Working tree changes</span>
            <span className="commit-detail-hash">live</span>
          </div>
          <div className="commit-detail-line">
            <GitBranch size={13} />
            <span>
              On branch: <strong>{branchName ?? "current"}</strong>
            </span>
          </div>
          <div className="commit-detail-line muted">
            <span>{fileCount} changed {fileCount === 1 ? "file" : "files"}</span>
          </div>
        </div>
      )}
    </section>
  );
}
