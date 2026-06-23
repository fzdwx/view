import type { BranchInfo, CommitInfo, ReflogEntry } from "../../lib/api";
import type { GitWriteActions } from "../../hooks/useGitWriteActions";

export interface VirtualCommitListProps {
  readonly commits: CommitInfo[];
  readonly graphWidthCommits: CommitInfo[];
  readonly activeCommit: string | null;
  readonly activeReflogSelector: string | null;
  readonly branch: BranchInfo | null;
  readonly filter: string;
  readonly gitWriteActions: GitWriteActions;
  readonly historyMode: "commits" | "reflog";
  readonly loading: boolean;
  readonly onChangeFilter: (filter: string) => void;
  readonly onChangeHistoryMode: (mode: "commits" | "reflog") => void;
  readonly onChangeReflogFilter: (filter: string) => void;
  readonly reflogEntries: ReflogEntry[];
  readonly reflogFilter: string;
  readonly reflogLoading: boolean;
  readonly onSelectCommit: (hash: string) => void;
  readonly onSelectReflogEntry: (entry: ReflogEntry) => void;
  readonly onRestoreReflogEntry: (selector: string) => void | Promise<void>;
  readonly onSelectWorkingTree: () => void;
}
