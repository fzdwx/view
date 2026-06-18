import { useMemo } from "react";
import type { ChangeEvent } from "react";
import { GitBranch, GitCommitHorizontal, Loader2 } from "lucide-react";
import type { TreeFile } from "../../lib/api";
import type { GitWriteActions } from "../../hooks/useGitWriteActions";

export interface CommitFormProps {
  readonly branchName?: string;
  readonly files: readonly TreeFile[];
  readonly gitWriteActions: GitWriteActions;
}

export function CommitForm({
  branchName,
  files,
  gitWriteActions,
}: CommitFormProps) {
  const unstagedCount = useMemo(() => countUnstagedFiles(files), [files]);
  const commitButtonTitle =
    gitWriteActions.commitDisabledReason ?? "Commit staged changes";

  function handleMessageChange(event: ChangeEvent<HTMLTextAreaElement>) {
    gitWriteActions.setCommitMessage(event.target.value);
  }

  function commitStagedChanges() {
    if (!gitWriteActions.canCommit) {
      return;
    }
    void gitWriteActions.commitStagedChanges();
  }

  return (
    <form
      className="commit-form"
      onSubmit={(event) => {
        event.preventDefault();
        commitStagedChanges();
      }}
    >
      <div className="commit-detail-heading">
        <span className="commit-detail-subject">Commit staged changes</span>
        <span className="commit-detail-hash">working tree</span>
      </div>
      <div className="commit-detail-line">
        <GitBranch size={13} />
        <span>
          On branch: <strong>{branchName ?? "current"}</strong>
        </span>
      </div>
      <div className="commit-form-counts" aria-label="Working tree change counts">
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
      </div>
      <div className="commit-form-scope">
        Commit scope: staged changes only. Unstaged and untracked files stay in
        the working tree.
      </div>
      <label className="commit-message-field">
        <span>Message</span>
        <textarea
          value={gitWriteActions.commitMessage}
          disabled={gitWriteActions.commitPending}
          placeholder="Summary, then optional details"
          rows={4}
          onChange={handleMessageChange}
        />
      </label>
      <div className="commit-form-footer">
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
        {gitWriteActions.commitWarning ? (
          <span className="commit-form-warning" title={gitWriteActions.commitWarning}>
            {gitWriteActions.commitWarning}
          </span>
        ) : null}
      </div>
      {gitWriteActions.commitError ? (
        <div className="commit-form-error" role="alert">
          {gitWriteActions.commitError}
        </div>
      ) : null}
    </form>
  );
}

function countUnstagedFiles(files: readonly TreeFile[]): number {
  return files.filter((file) => file.unstaged === true || file.untracked === true)
    .length;
}
