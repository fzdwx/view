import type { CSSProperties, RefObject } from "react";
import { createPortal } from "react-dom";
import { RotateCcw } from "lucide-react";
import type { BranchInfo, ReflogEntry } from "../../lib/api";
import type { GitWriteActions } from "../../hooks/useGitWriteActions";
import { clamp } from "../../lib/numeric";
import type { ListVirtualizer } from "./CommitListVirtualizer";
import { CommitListHeader } from "./CommitListHeader";
import { ReflogRow } from "./CommitRows";

export type ReflogMenu = {
  readonly entry: ReflogEntry;
  readonly left: number;
  readonly top: number;
};

export function ReflogListView({
  activeCommit,
  activeReflogSelector,
  branch,
  filter,
  gitWriteActions,
  reflogEntries,
  reflogMenu,
  scrollRef,
  tableStyle,
  virtualizer,
  onChangeFilter,
  onChangeHistoryMode,
  onRestoreReflogEntry,
  onSelectReflogEntry,
  onSelectWorkingTree,
  onSetReflogMenu,
}: {
  readonly activeCommit: string | null;
  readonly activeReflogSelector: string | null;
  readonly branch: BranchInfo | null;
  readonly filter: string;
  readonly gitWriteActions: GitWriteActions;
  readonly reflogEntries: readonly ReflogEntry[];
  readonly reflogMenu: ReflogMenu | null;
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  readonly tableStyle: CSSProperties;
  readonly virtualizer: ListVirtualizer;
  readonly onChangeFilter: (filter: string) => void;
  readonly onChangeHistoryMode: (mode: "commits" | "reflog") => void;
  readonly onRestoreReflogEntry: (selector: string) => void | Promise<void>;
  readonly onSelectReflogEntry: (entry: ReflogEntry) => void;
  readonly onSelectWorkingTree: () => void;
  readonly onSetReflogMenu: (menu: ReflogMenu | null) => void;
}) {
  return (
    <div className="reflog-table" style={tableStyle}>
      <CommitListHeader
        activeCommit={activeCommit}
        branch={branch}
        filter={filter}
        gitWriteActions={gitWriteActions}
        historyMode="reflog"
        onChangeFilter={onChangeFilter}
        onChangeHistoryMode={onChangeHistoryMode}
        onSelectWorkingTree={onSelectWorkingTree}
      />
      <div ref={scrollRef} className="commit-list">
        <div ref={virtualizer.containerRef} className="commit-list-spacer">
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const entry = reflogEntries[virtualItem.index];
            return (
              <div
                key={virtualItem.key}
                className="commit-list-virtual-row"
                data-index={virtualItem.index}
                ref={(node) => {
                  virtualizer.measureElement(node);
                }}
              >
                <ReflogRow
                  active={activeReflogSelector === entry.selector}
                  entry={entry}
                  onClick={() => onSelectReflogEntry(entry)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelectReflogEntry(entry);
                    onSetReflogMenu({
                      entry,
                      left: event.clientX,
                      top: event.clientY,
                    });
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
      {reflogMenu ? (
        <ReflogContextMenu
          disabled={Boolean(gitWriteActions.resetDisabledReason)}
          disabledReason={gitWriteActions.resetDisabledReason ?? undefined}
          left={reflogMenu.left}
          selector={reflogMenu.entry.selector}
          top={reflogMenu.top}
          onReset={() => {
            onSetReflogMenu(null);
            void onRestoreReflogEntry(reflogMenu.entry.selector);
          }}
        />
      ) : null}
    </div>
  );
}

function ReflogContextMenu({
  disabled,
  disabledReason,
  left,
  selector,
  top,
  onReset,
}: {
  readonly disabled: boolean;
  readonly disabledReason?: string;
  readonly left: number;
  readonly selector: string;
  readonly top: number;
  readonly onReset: () => void;
}) {
  const menuStyle: CSSProperties = {
    left: clamp(left, 8, window.innerWidth - 228),
    top: clamp(top, 8, window.innerHeight - 120),
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
        className="danger"
        disabled={disabled}
        title={disabledReason ?? `Reset --hard to ${selector}`}
        onClick={onReset}
      >
        <RotateCcw size={13} />
        <span>{`Reset --hard to ${selector}`}</span>
      </button>
    </div>,
    document.body,
  );
}
