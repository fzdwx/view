import type { CommitGraphRow } from "./commitGraph";

export const COMMIT_GRAPH_LANE_GAP = 10;
export const COMMIT_GRAPH_LEFT_INSET = 7.5;
export const COMMIT_GRAPH_RIGHT_INSET = 10;
export const COMMIT_GRAPH_MIN_WIDTH = 24;

export function getCommitGraphWidth(laneCount: number) {
  return Math.ceil(
    Math.max(
      COMMIT_GRAPH_MIN_WIDTH,
      COMMIT_GRAPH_LEFT_INSET +
        (laneCount - 1) * COMMIT_GRAPH_LANE_GAP +
        COMMIT_GRAPH_RIGHT_INSET,
    ),
  );
}

export function getCommitGraphColumnWidth(rows: readonly CommitGraphRow[]) {
  return Math.max(
    COMMIT_GRAPH_MIN_WIDTH,
    ...rows.map((row) => getCommitGraphWidth(row.laneCount)),
  );
}

export function commitGraphWidthRows({
  filteredRows,
  fullRows,
  hasFilter,
}: {
  readonly filteredRows: readonly CommitGraphRow[];
  readonly fullRows: readonly CommitGraphRow[];
  readonly hasFilter: boolean;
}) {
  return hasFilter ? filteredRows : fullRows;
}
