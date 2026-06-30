import { useCallback, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { GitCommitHorizontal, Undo2 } from "lucide-react";
import type { BranchInfo, CommitInfo } from "../../lib/api";
import type { CommitGraphRow } from "../../lib/commitGraph";
import type { GitWriteActions } from "../../hooks/useGitWriteActions";
import { clamp } from "../../lib/numeric";
import type { ListVirtualizer } from "./CommitListVirtualizer";
import { CommitListHeader } from "./CommitListHeader";
import { CommitRow } from "./CommitRows";

export type CommitMenu = {
  readonly commit: CommitInfo;
  readonly left: number;
  readonly top: number;
};

export function CommitListView({
  activeCommit,
  branch,
  commitMenu,
  filter,
  gitWriteActions,
  graphRows,
  scrollRef,
  tableStyle,
  virtualizer,
  onChangeFilter,
  onChangeHistoryMode,
  onSelectCommit,
  onSelectWorkingTree,
  onSetCommitMenu,
}: {
  readonly activeCommit: string | null;
  readonly branch: BranchInfo | null;
  readonly commitMenu: CommitMenu | null;
  readonly filter: string;
  readonly gitWriteActions: GitWriteActions;
  readonly graphRows: readonly CommitGraphRow[];
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  readonly tableStyle: CSSProperties;
  readonly virtualizer: ListVirtualizer;
  readonly onChangeFilter: (filter: string) => void;
  readonly onChangeHistoryMode: (mode: "commits" | "reflog") => void;
  readonly onSelectCommit: (hash: string) => void;
  readonly onSelectWorkingTree: () => void;
  readonly onSetCommitMenu: (menu: CommitMenu | null) => void;
}) {
  const openCommitMenu = useCallback(
    (commit: CommitInfo, left: number, top: number) => {
      onSetCommitMenu({
        commit,
        left,
        top,
      });
    },
    [onSetCommitMenu],
  );

  return (
    <div className="commit-table" style={tableStyle}>
      <CommitListHeader
        activeCommit={activeCommit}
        branch={branch}
        filter={filter}
        gitWriteActions={gitWriteActions}
        historyMode="commits"
        onChangeFilter={onChangeFilter}
        onChangeHistoryMode={onChangeHistoryMode}
        onSelectWorkingTree={onSelectWorkingTree}
      />
      <div ref={scrollRef} className="commit-list">
        <div ref={virtualizer.containerRef} className="commit-list-spacer">
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const graphRow = graphRows[virtualItem.index];
            const commit = graphRow.commit;
            return (
              <div
                key={virtualItem.key}
                className="commit-list-virtual-row"
                data-index={virtualItem.index}
                ref={(node) => {
                  virtualizer.measureElement(node);
                }}
              >
                <CommitRow
                  row={graphRow}
                  active={activeCommit === commit.hash}
                  onOpenContextMenu={openCommitMenu}
                  onSelectCommit={onSelectCommit}
                />
              </div>
            );
          })}
        </div>
      </div>
      {commitMenu ? (
        <CommitContextMenu
          commit={commitMenu.commit}
          disabled={Boolean(gitWriteActions.historyOperationDisabledReason)}
          disabledReason={
            gitWriteActions.historyOperationDisabledReason ?? undefined
          }
          left={commitMenu.left}
          top={commitMenu.top}
          onCherryPick={() => {
            onSetCommitMenu(null);
            void gitWriteActions.cherryPickHistoryCommit(
              commitMenu.commit.hash,
            );
          }}
          onRevert={() => {
            onSetCommitMenu(null);
            void gitWriteActions.revertHistoryCommit(commitMenu.commit.hash);
          }}
        />
      ) : null}
    </div>
  );
}

function CommitContextMenu({
  commit,
  disabled,
  disabledReason,
  left,
  top,
  onCherryPick,
  onRevert,
}: {
  readonly commit: CommitInfo;
  readonly disabled: boolean;
  readonly disabledReason?: string;
  readonly left: number;
  readonly top: number;
  readonly onCherryPick: () => void;
  readonly onRevert: () => void;
}) {
  const commitLabel = commit.shortHash || commit.hash.slice(0, 12);
  const menuStyle: CSSProperties = {
    left: clamp(left, 8, window.innerWidth - 228),
    top: clamp(top, 8, window.innerHeight - 148),
  };

  return createPortal(
    <div
      className="branch-context-menu"
      role="menu"
      tabIndex={-1}
      style={menuStyle}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        title={disabledReason ?? `Cherry-pick ${commitLabel}`}
        onClick={onCherryPick}
      >
        <GitCommitHorizontal size={13} />
        <span>{`Cherry-pick ${commitLabel}`}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="danger"
        disabled={disabled}
        title={disabledReason ?? `Revert ${commitLabel}`}
        onClick={onRevert}
      >
        <Undo2 size={13} />
        <span>{`Revert ${commitLabel}`}</span>
      </button>
    </div>,
    document.body,
  );
}
