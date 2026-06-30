import { memo, useId, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { BranchInfo, WorktreeInfo } from "../../lib/api";
import type { WorktreeActions } from "../../hooks/useWorktreeActions";
import {
  isSameWorktreePath,
  worktreePathLabel,
} from "../../lib/worktreeActions";

export const WorktreeList = memo(function WorktreeList({
  actions,
  activePath,
  sourceBranch,
  worktrees,
}: {
  readonly actions: WorktreeActions;
  readonly activePath: string | null;
  readonly sourceBranch: BranchInfo | null;
  readonly worktrees: readonly WorktreeInfo[];
}) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const pending = actions.pending;
  const busy = pending !== null;
  const count = worktrees.length;

  return (
    <section className="worktree-list" aria-label="Worktrees">
      <div className="worktree-list-header">
        <button
          type="button"
          className="worktree-list-toggle"
          aria-controls={bodyId}
          aria-expanded={expanded}
          title={expanded ? "Collapse worktrees" : "Expand worktrees"}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="worktree-list-title">Worktrees</span>
        </button>
        <span className="worktree-list-count">{count}</span>
        <button
          type="button"
          className="worktree-icon-button"
          title={
            sourceBranch
              ? `New worktree from ${sourceBranch.name}`
              : "Select a branch to create a worktree"
          }
          disabled={!sourceBranch || busy}
          onClick={() => {
            void actions.createFromBranch(sourceBranch);
          }}
        >
          <Plus size={13} />
        </button>
        <button
          type="button"
          className="worktree-icon-button"
          title="Prune stale worktrees"
          disabled={busy}
          onClick={() => {
            void actions.prune();
          }}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {expanded ? (
        <div id={bodyId} className="worktree-list-body">
          {worktrees.map((worktree) => {
            const active =
              activePath !== null &&
              isSameWorktreePath(activePath, worktree.path);
            const removing =
              pending?.kind === "remove" && pending.path === worktree.path;
            const branchLabel =
              worktree.branch ?? (worktree.detached ? "detached" : "unknown");
            const pathLabel = worktreePathLabel(worktree.path);

            return (
              <div
                key={worktree.path}
                className={active ? "worktree-row active" : "worktree-row"}
              >
                <button
                  type="button"
                  className="worktree-switch-button"
                  title={worktree.path}
                  disabled={active || busy}
                  onClick={() => actions.switchTo(worktree)}
                >
                  {active ? <Check size={13} /> : <FolderOpen size={13} />}
                  <span className="worktree-branch">{branchLabel}</span>
                  <small className="worktree-path">{pathLabel}</small>
                </button>
                <button
                  type="button"
                  className="worktree-remove-button"
                  title={`Remove ${pathLabel}`}
                  disabled={active || worktree.bare || busy}
                  onClick={() => {
                    void actions.remove(worktree);
                  }}
                >
                  {removing ? <RefreshCw size={12} /> : <Trash2 size={12} />}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
});

WorktreeList.displayName = "WorktreeList";
