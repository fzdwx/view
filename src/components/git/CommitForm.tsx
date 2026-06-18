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
      <header className="commit-form-header">
        <div className="commit-form-branch">
          <GitBranch size={13} />
          <strong>{branchName ?? "current"}</strong>
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
      </header>
      <label className="commit-message-field">
        <textarea
          value={gitWriteActions.commitMessage}
          disabled={gitWriteActions.commitPending}
          placeholder="Commit message"
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
