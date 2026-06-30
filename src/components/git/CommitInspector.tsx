import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  Copy,
  GitBranch,
  GitCompare,
  GitFork,
  RotateCcw,
  ShieldCheck,
  ShieldQuestionMark,
  Tags,
} from "lucide-react";
import type { CommitInfo, ReflogEntry, RepositoryPayload } from "../../lib/api";
import {
  commitCompareLabel,
  commitDetailsCopyText,
  commitParentLabels,
  commitRefLabel,
  commitSignatureLabel,
} from "../../lib/commitDetails";
import { formatDate } from "../../lib/dateFormat";
import { clamp } from "../../lib/numeric";
import { useCommitDetails } from "../../hooks/useCommitDetails";
import { ResizeHandle } from "../ResizeHandle";
import { TreePanel } from "../TreePanel";
import type { TreeGitFileActions } from "../TreeContextMenu";
import type { GitWriteActions } from "../../hooks/useGitWriteActions";
import { CommitForm } from "./CommitForm";

const minCommitDetailHeight = 110;
const maxCommitDetailHeight = 360;

export function CommitInspector({
  commit,
  projectPath,
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
  projectPath: string | null;
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
  const panelRef = useRef<HTMLElement | null>(null);
  const draftDetailRef = useRef<number | null>(null);
  const isHorizontal = orientation === "horizontal";
  const panelStyle = useMemo(
    () =>
      isHorizontal
        ? { gridTemplateColumns: commitInspectorGridTemplate(detailHeight) }
        : { gridTemplateRows: commitInspectorGridTemplate(detailHeight) },
    [detailHeight, isHorizontal],
  );

  useLayoutEffect(() => {
    draftDetailRef.current = null;
    applyCommitInspectorSize(panelRef.current, isHorizontal, detailHeight);
  }, [detailHeight, isHorizontal]);

  const handleResizePreview = useCallback(
    (delta: number) => {
      const base = draftDetailRef.current ?? detailHeight;
      const next = clamp(
        base - delta,
        minCommitDetailHeight,
        maxCommitDetailHeight,
      );
      if (next === base) {
        return;
      }

      draftDetailRef.current = next;
      applyCommitInspectorSize(panelRef.current, isHorizontal, next);
    },
    [detailHeight, isHorizontal],
  );
  const handleResizeCommit = useCallback(
    (totalDelta: number) => {
      const next =
        draftDetailRef.current ??
        clamp(
          detailHeight - totalDelta,
          minCommitDetailHeight,
          maxCommitDetailHeight,
        );
      draftDetailRef.current = null;

      const delta = next - detailHeight;
      applyCommitInspectorSize(panelRef.current, isHorizontal, next);
      if (delta !== 0) {
        onResizeDetails(delta);
      }
    },
    [detailHeight, isHorizontal, onResizeDetails],
  );

  return (
    <aside
      ref={panelRef}
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
        projectPath={projectPath}
        selectedReflogEntry={selectedReflogEntry}
        showCommitForm={showCommitForm}
      />
    </aside>
  );
}

function commitInspectorGridTemplate(size: number): string {
  return `minmax(0, 1fr) 6px ${size}px`;
}

function applyCommitInspectorSize(
  element: HTMLElement | null,
  isHorizontal: boolean,
  size: number,
): void {
  if (!element) {
    return;
  }

  const template = commitInspectorGridTemplate(size);
  if (isHorizontal) {
    element.style.gridTemplateColumns = template;
    element.style.gridTemplateRows = "";
    return;
  }

  element.style.gridTemplateRows = template;
  element.style.gridTemplateColumns = "";
}

const CommitDetails = memo(function CommitDetails({
  commit,
  branchName,
  files,
  gitFileActions,
  gitWriteActions,
  historyMode,
  projectPath,
  selectedReflogEntry,
  showCommitForm,
}: {
  commit: CommitInfo | null;
  branchName?: string;
  files: RepositoryPayload["files"];
  gitFileActions?: TreeGitFileActions;
  gitWriteActions: GitWriteActions;
  historyMode: "commits" | "reflog";
  projectPath: string | null;
  selectedReflogEntry: ReflogEntry | null;
  showCommitForm: boolean;
}) {
  const { commitDetails, query: commitDetailsQuery } = useCommitDetails(
    projectPath,
    commit?.hash ?? null,
  );
  const handleCopyHash = useCallback(() => {
    if (!commit) {
      return;
    }
    const copyText = commitDetails
      ? commitDetailsCopyText(commitDetails)
      : commit.hash;
    void navigator.clipboard?.writeText(copyText).catch(() => undefined);
  }, [commit, commitDetails]);
  const handleCopyCompareRange = useCallback(() => {
    if (!commitDetails?.compareBase) {
      return;
    }
    void navigator.clipboard
      ?.writeText(`${commitDetails.compareBase}..${commitDetails.hash}`)
      .catch(() => undefined);
  }, [commitDetails]);

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
  const parentLabels = commitParentLabels(
    commitDetails?.parents ?? commit.parents,
  );
  const refs = commitDetails?.refs ?? [];
  const compareLabel = commitDetails
    ? commitCompareLabel(commitDetails)
    : null;
  const signatureLabel = commitDetails
    ? commitSignatureLabel(commitDetails.signature)
    : null;
  const hasCommitBody = Boolean(commitDetails?.body.trim());

  return (
    <section className="commit-details-section">
      <div className="commit-detail-body">
        <div className="commit-detail-heading">
          <span className="commit-detail-subject">{commit.subject}</span>
          <button
            type="button"
            className="commit-detail-hash commit-detail-hash-button mono-value"
            title="Copy full commit hash"
            aria-label="Copy full commit hash"
            onClick={handleCopyHash}
          >
            <Copy size={12} />
            <span>{commit.shortHash}</span>
          </button>
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
        {commitDetailsQuery.isError ? (
          <div className="commit-detail-line muted">
            <span>Commit details unavailable</span>
          </div>
        ) : commitDetailsQuery.isFetching && !commitDetails ? (
          <div className="commit-detail-line muted">
            <span>Loading commit details...</span>
          </div>
        ) : null}
        {hasCommitBody ? (
          <pre className="commit-detail-message">{commitDetails?.body}</pre>
        ) : null}
        {parentLabels.length > 0 ? (
          <DetailChipRow icon={<GitFork size={13} />} label="Parents">
            {parentLabels.map((parent) => (
              <span key={parent} className="compact-detail-pill mono-value">
                {parent}
              </span>
            ))}
          </DetailChipRow>
        ) : null}
        {refs.length > 0 ? (
          <DetailChipRow icon={<Tags size={13} />} label="Refs">
            {refs.map((ref) => (
              <span key={ref} className="compact-detail-chip mono-value">
                <span>{commitRefLabel(ref)}</span>
              </span>
            ))}
          </DetailChipRow>
        ) : null}
        {signatureLabel ? (
          <div className="commit-detail-line muted">
            {commitDetails?.signature.status === "valid" ? (
              <ShieldCheck size={13} />
            ) : (
              <ShieldQuestionMark size={13} />
            )}
            <span>{signatureLabel}</span>
          </div>
        ) : null}
        {compareLabel && commitDetails?.compareBase ? (
          <button
            type="button"
            className="commit-detail-compare-button"
            title="Copy compare range"
            onClick={handleCopyCompareRange}
          >
            <GitCompare size={13} />
            <span>{compareLabel}</span>
          </button>
        ) : null}
      </div>
    </section>
  );
});

CommitDetails.displayName = "CommitDetails";

function DetailChipRow({
  children,
  icon,
  label,
}: {
  readonly children: ReactNode;
  readonly icon: ReactNode;
  readonly label: string;
}) {
  return (
    <div className="commit-detail-chip-row">
      <span className="commit-detail-chip-row-label">
        {icon}
        <span>{label}</span>
      </span>
      <span className="commit-detail-chip-row-values">{children}</span>
    </div>
  );
}
