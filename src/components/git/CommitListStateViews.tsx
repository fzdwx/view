import type { CSSProperties } from "react";
import type { BranchInfo } from "../../lib/api";
import type { GitWriteActions } from "../../hooks/useGitWriteActions";
import { LoadingRows } from "../LoadingRows";
import { CommitListHeader } from "./CommitListHeader";

export function HistoryLoadingView({
  activeCommit,
  branch,
  filter,
  gitWriteActions,
  historyMode,
  isReflogMode,
  tableStyle,
  onChangeFilter,
  onChangeHistoryMode,
  onSelectWorkingTree,
}: {
  readonly activeCommit: string | null;
  readonly branch: BranchInfo | null;
  readonly filter: string;
  readonly gitWriteActions: GitWriteActions;
  readonly historyMode: "commits" | "reflog";
  readonly isReflogMode: boolean;
  readonly tableStyle: CSSProperties;
  readonly onChangeFilter: (filter: string) => void;
  readonly onChangeHistoryMode: (mode: "commits" | "reflog") => void;
  readonly onSelectWorkingTree: () => void;
}) {
  return (
    <div className={isReflogMode ? "reflog-table" : "commit-table"} style={tableStyle}>
      <CommitListHeader
        activeCommit={activeCommit}
        branch={branch}
        filter={filter}
        gitWriteActions={gitWriteActions}
        historyMode={historyMode}
        onChangeFilter={onChangeFilter}
        onChangeHistoryMode={onChangeHistoryMode}
        onSelectWorkingTree={onSelectWorkingTree}
      />
      <div className="commit-list">
        <LoadingRows />
      </div>
    </div>
  );
}

export function HistoryEmptyView({
  activeCommit,
  branch,
  filter,
  gitWriteActions,
  historyMode,
  message,
  tableClassName,
  tableStyle,
  onChangeFilter,
  onChangeHistoryMode,
  onSelectWorkingTree,
}: {
  readonly activeCommit: string | null;
  readonly branch: BranchInfo | null;
  readonly filter: string;
  readonly gitWriteActions: GitWriteActions;
  readonly historyMode: "commits" | "reflog";
  readonly message: string;
  readonly tableClassName: string;
  readonly tableStyle: CSSProperties;
  readonly onChangeFilter: (filter: string) => void;
  readonly onChangeHistoryMode: (mode: "commits" | "reflog") => void;
  readonly onSelectWorkingTree: () => void;
}) {
  return (
    <div className={tableClassName} style={tableStyle}>
      <CommitListHeader
        activeCommit={activeCommit}
        branch={branch}
        filter={filter}
        gitWriteActions={gitWriteActions}
        historyMode={historyMode}
        onChangeFilter={onChangeFilter}
        onChangeHistoryMode={onChangeHistoryMode}
        onSelectWorkingTree={onSelectWorkingTree}
      />
      <div className="commit-list empty-list">
        <div className="empty-inline">{message}</div>
      </div>
    </div>
  );
}
