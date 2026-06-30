import {
  memo,
  useCallback,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { CommitInfo, ReflogEntry } from "../../lib/api";
import type { CommitGraphRow } from "../../lib/commitGraph";
import { formatDate } from "../../lib/dateFormat";
import { CommitGraph } from "./CommitGraph";
import { CommitTrackingBadge } from "./CommitTrackingBadge";

export const ReflogRow = memo(function ReflogRow({
  active,
  entry,
  onOpenContextMenu,
  onSelectReflogEntry,
}: {
  readonly active: boolean;
  readonly entry: ReflogEntry;
  readonly onOpenContextMenu: (
    entry: ReflogEntry,
    left: number,
    top: number,
  ) => void;
  readonly onSelectReflogEntry: (entry: ReflogEntry) => void;
}) {
  const subject = reflogPrimaryText(entry);
  const handleClick = useCallback(() => {
    onSelectReflogEntry(entry);
  }, [entry, onSelectReflogEntry]);
  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onSelectReflogEntry(entry);
      onOpenContextMenu(entry, event.clientX, event.clientY);
    },
    [entry, onOpenContextMenu, onSelectReflogEntry],
  );

  return (
    <button
      type="button"
      title={`${subject} (${entry.shortHash})`}
      data-reflog-selector={entry.selector}
      className={active ? "reflog-row active" : "reflog-row"}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      <span className="reflog-selector">{entry.selector}</span>
      <span className="commit-subject reflog-subject">
        <span className="commit-subject-text">{subject}</span>
      </span>
      <span className="commit-author">{entry.author}</span>
      <span className="commit-date">{formatDate(entry.date)}</span>
      <span className="commit-hash">{entry.shortHash}</span>
    </button>
  );
});

ReflogRow.displayName = "ReflogRow";

export const CommitRow = memo(function CommitRow({
  row,
  active,
  onOpenContextMenu,
  onSelectCommit,
}: {
  readonly row: CommitGraphRow;
  readonly active: boolean;
  readonly onOpenContextMenu: (
    commit: CommitInfo,
    left: number,
    top: number,
  ) => void;
  readonly onSelectCommit: (hash: string) => void;
}) {
  const { commit } = row;
  const handleClick = useCallback(() => {
    onSelectCommit(commit.hash);
  }, [commit.hash, onSelectCommit]);
  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onSelectCommit(commit.hash);
      onOpenContextMenu(commit, event.clientX, event.clientY);
    },
    [commit, onOpenContextMenu, onSelectCommit],
  );
  const className = [
    "commit-row",
    active ? "active" : null,
    commit.tracking?.side === "upstream" ? "remote-only" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      title={`${commit.subject} (${commit.shortHash})`}
      data-commit-hash={commit.hash}
      className={className}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      <span className="commit-graph-cell">
        <CommitGraph row={row} />
      </span>
      <span className="commit-subject">
        <span className="commit-subject-text">{commit.subject}</span>
        <CommitTrackingBadge commit={commit} />
      </span>
      <span className="commit-author">{commit.author}</span>
      <span className="commit-date">{formatDate(commit.date)}</span>
      <span className="commit-hash">{commit.shortHash}</span>
    </button>
  );
});

CommitRow.displayName = "CommitRow";

function reflogPrimaryText(entry: ReflogEntry): string {
  const subject = entry.subject.trim();
  if (!subject) {
    return entry.action;
  }

  if (entry.action.toLowerCase().includes(subject.toLowerCase())) {
    return entry.action;
  }

  return `${entry.action} - ${subject}`;
}
