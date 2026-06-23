import type { CSSProperties, RefObject } from "react";
import type { BranchInfo } from "../../lib/api";
import type { CommitGraphRow } from "../../lib/commitGraph";
import type { GitWriteActions } from "../../hooks/useGitWriteActions";
import type { ListVirtualizer } from "./CommitListVirtualizer";
import { CommitListHeader } from "./CommitListHeader";
import { CommitRow } from "./CommitRows";

export function CommitListView({
  activeCommit,
  branch,
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
}: {
  readonly activeCommit: string | null;
  readonly branch: BranchInfo | null;
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
}) {
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
                  onClick={() => onSelectCommit(commit.hash)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
