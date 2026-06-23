import { useMemo } from "react";
import type { ChangeEvent } from "react";
import {
  GitBranch,
  GitCommitHorizontal,
  Loader2,
  Minus,
  Plus,
} from "lucide-react";
import type { TreeFile } from "../../lib/api";
import {
  stageableFilePaths,
  unstageableFilePaths,
} from "../../lib/gitBatchFileActions";
import type { GitWriteActions } from "../../hooks/useGitWriteActions";
import type { TreeGitFileActions } from "../TreeContextMenu";

export interface CommitFormProps {
  readonly branchName?: string;
  readonly files: readonly TreeFile[];
  readonly gitFileActions?: TreeGitFileActions;
  readonly gitWriteActions: GitWriteActions;
}

export function CommitForm({
  branchName,
  files,
  gitFileActions,
  gitWriteActions,
}: CommitFormProps) {
  const unstagedCount = useMemo(() => countUnstagedFiles(files), [files]);
  const stageablePaths = useMemo(() => stageableFilePaths(files), [files]);
  const unstageablePaths = useMemo(() => unstageableFilePaths(files), [files]);
  const commitButtonTitle =
    gitWriteActions.commitDisabledReason ?? "Commit staged changes";
  const pendingTitle =
    gitFileActions?.pendingTitle ?? gitWriteActions.gitWritePendingReason;
  const stageAllTitle =
    pendingTitle ??
    batchActionTitle(
      "Stage",
      stageablePaths.length,
      "No unstaged changes to stage.",
    );
  const unstageAllTitle =
    pendingTitle ??
    batchActionTitle(
      "Unstage",
      unstageablePaths.length,
      "No staged changes to unstage.",
    );
  const canRunBatchAction = gitFileActions?.canRun === true;
  const canStageAll =
    canRunBatchAction &&
    stageablePaths.length > 0 &&
    Boolean(gitFileActions?.onStageFiles);
  const canUnstageAll =
    canRunBatchAction &&
    unstageablePaths.length > 0 &&
    Boolean(gitFileActions?.onUnstageFiles);

  function handleMessageChange(event: ChangeEvent<HTMLTextAreaElement>) {
    gitWriteActions.setCommitMessage(event.target.value);
  }

  function commitStagedChanges() {
    if (!gitWriteActions.canCommit) {
      return;
    }
    void gitWriteActions.commitStagedChanges();
  }

  function stageAll() {
    if (!canStageAll) {
      return;
    }
    gitFileActions?.onStageFiles?.(stageablePaths);
  }

  function unstageAll() {
    if (!canUnstageAll) {
      return;
    }
    gitFileActions?.onUnstageFiles?.(unstageablePaths);
  }

  return (
    <form
      className="commit-form"
      onSubmit={(event) => {
        event.preventDefault();
        commitStagedChanges();
      }}
    >
      <header className="commit-form-header">
        <div className="commit-form-branch">
          <GitBranch size={13} />
          <strong>{branchName ?? "current"}</strong>
        </div>
        <div
          className="commit-form-counts"
          aria-label="Working tree change counts"
        >
          <span className="commit-count-pill staged">
            <strong>{gitWriteActions.stagedCount}</strong>
            staged
          </span>
          <span className="commit-count-pill unstaged">
            <strong>{unstagedCount}</strong>
            unstaged
          </span>
          {gitWriteActions.conflictCount > 0 ? (
            <span className="commit-count-pill conflict">
              <strong>{gitWriteActions.conflictCount}</strong>
              conflicted
            </span>
          ) : null}
          <button
            className="commit-batch-button stage"
            type="button"
            disabled={!canStageAll}
            title={stageAllTitle}
            onClick={stageAll}
          >
            <Plus size={12} />
            <span>Stage all</span>
          </button>
          <button
            className="commit-batch-button"
            type="button"
            disabled={!canUnstageAll}
            title={unstageAllTitle}
            onClick={unstageAll}
          >
            <Minus size={12} />
            <span>Unstage all</span>
          </button>
        </div>
      </header>
      <label className="commit-message-field" aria-label="Commit message">
        <textarea
          value={gitWriteActions.commitMessage}
          disabled={gitWriteActions.commitPending}
          placeholder="Commit message"
          aria-label="Commit message"
          onChange={handleMessageChange}
        />
      </label>
      <footer className="commit-form-footer">
        <button
          className="commit-submit-button"
          type="submit"
          disabled={!gitWriteActions.canCommit}
          title={commitButtonTitle}
        >
          {gitWriteActions.commitPending ? (
            <Loader2 className="spin" size={14} />
          ) : (
            <GitCommitHorizontal size={14} />
          )}
          <span>{gitWriteActions.commitPending ? "Committing" : "Commit"}</span>
        </button>
        {gitWriteActions.commitMessageHint ? (
          <span
            className="commit-form-hint"
            title={gitWriteActions.commitMessageHint}
          >
            {gitWriteActions.commitMessageHint}
          </span>
        ) : null}
        {gitWriteActions.commitWarning ? (
          <span className="commit-form-warning" title={gitWriteActions.commitWarning}>
            {gitWriteActions.commitWarning}
          </span>
        ) : null}
        {gitWriteActions.commitError ? (
          <span className="commit-form-error" role="alert">
            {gitWriteActions.commitError}
          </span>
        ) : null}
      </footer>
    </form>
  );
}

function countUnstagedFiles(files: readonly TreeFile[]): number {
  return files.filter((file) => file.unstaged === true || file.untracked === true)
    .length;
}

function batchActionTitle(
  verb: string,
  fileCount: number,
  emptyTitle: string,
): string {
  if (fileCount === 0) {
    return emptyTitle;
  }

  return `${verb} ${fileCount} file${fileCount === 1 ? "" : "s"}`;
}
