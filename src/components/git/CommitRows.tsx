import type { MouseEvent as ReactMouseEvent } from "react";
import type { ReflogEntry } from "../../lib/api";
import type { CommitGraphRow } from "../../lib/commitGraph";
import { formatDate } from "../../lib/dateFormat";
import { CommitGraph } from "./CommitGraph";
import { CommitTrackingBadge } from "./CommitTrackingBadge";

export function ReflogRow({
  active,
  entry,
  onClick,
  onContextMenu,
}: {
  readonly active: boolean;
  readonly entry: ReflogEntry;
  readonly onClick: () => void;
  readonly onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const subject = reflogPrimaryText(entry);

  return (
    <button
      type="button"
      title={`${subject} (${entry.shortHash})`}
      className={active ? "reflog-row active" : "reflog-row"}
      onClick={onClick}
      onContextMenu={onContextMenu}
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
}

export function CommitRow({
  row,
  active,
  onClick,
}: {
  readonly row: CommitGraphRow;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  const { commit } = row;
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
      className={className}
      onClick={onClick}
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
}

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
