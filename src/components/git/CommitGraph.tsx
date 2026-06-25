import type { CSSProperties } from "react";
import type { CommitGraphRow } from "../../lib/commitGraph";
import {
  COMMIT_GRAPH_LANE_GAP,
  COMMIT_GRAPH_LEFT_INSET,
  getCommitGraphWidth,
} from "../../lib/commitGraphLayout";

const COMMIT_GRAPH_ROW_HEIGHT = 28;
const COMMIT_GRAPH_MID_Y = 14;

const laneX = (lane: number) =>
  lane * COMMIT_GRAPH_LANE_GAP + COMMIT_GRAPH_LEFT_INSET;

const graphColor = (colorKey: string) =>
  ({
    "--commit-graph-color": commitGraphColor(colorKey),
  }) as CSSProperties;

export function CommitGraph({ row }: { row: CommitGraphRow }) {
  const width = getCommitGraphWidth(row.laneCount);
  const height = COMMIT_GRAPH_ROW_HEIGHT;
  const dotX = laneX(row.lane);
  const dotRadius = row.commit.parents.length > 1 ? 3.12 : 2.9;
  const dotGap = dotRadius + 0.08;
  const parentCurves = row.parentLanes.filter(
    (parentLane) => parentLane.index !== row.lane,
  );

  return (
    <span className="commit-graph" aria-hidden="true">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {row.throughLanes.map((throughLane) => (
          <path
            key={`through-${throughLane.fromIndex}-${throughLane.toIndex}`}
            className="commit-graph-line commit-graph-through-line"
            d={commitGraphThroughPath(
              laneX(throughLane.fromIndex),
              laneX(throughLane.toIndex),
            )}
            style={graphColor(throughLane.colorKey)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {parentCurves.map((parentLane, curveIndex) => {
          const parentX = laneX(parentLane.index);
          return (
            <path
              key={`parent-${parentLane.index}-${curveIndex}`}
              className="commit-graph-line commit-graph-parent-line"
              d={commitGraphCurvePath(
                dotX,
                parentX,
                dotGap,
                curveIndex,
                parentCurves.length,
              )}
              style={graphColor(parentLane.colorKey)}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {row.beforeLanes.map((lane) => (
          <line
            key={`before-${lane.index}`}
            className={
              lane.index === row.lane
                ? "commit-graph-line commit-graph-trunk commit-graph-node-trunk"
                : "commit-graph-line commit-graph-trunk"
            }
            x1={laneX(lane.index)}
            y1="-2"
            x2={laneX(lane.index)}
            y2={
              lane.index === row.lane
                ? COMMIT_GRAPH_MID_Y - dotGap
                : COMMIT_GRAPH_MID_Y
            }
            style={graphColor(lane.colorKey)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {row.afterLanes.map((lane) => (
          <line
            key={`after-${lane.index}`}
            className={
              lane.index === row.lane
                ? "commit-graph-line commit-graph-trunk commit-graph-node-trunk"
                : "commit-graph-line commit-graph-trunk"
            }
            x1={laneX(lane.index)}
            y1={
              lane.index === row.lane
                ? COMMIT_GRAPH_MID_Y + dotGap
                : COMMIT_GRAPH_MID_Y
            }
            x2={laneX(lane.index)}
            y2={height + 2}
            style={graphColor(lane.colorKey)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <circle
          className="commit-graph-node-outline"
          cx={dotX}
          cy={COMMIT_GRAPH_MID_Y}
          r={dotRadius + 0.24}
        />
        <circle
          className={
            row.commit.parents.length > 1
              ? "commit-graph-node merge"
              : "commit-graph-node"
          }
          cx={dotX}
          cy={COMMIT_GRAPH_MID_Y}
          r={dotRadius}
          style={graphColor(row.colorKey)}
        />
      </svg>
    </span>
  );
}

function commitGraphCurvePath(
  sourceX: number,
  targetX: number,
  sourceGap: number,
  curveIndex: number,
  curveCount: number,
) {
  const bottomY = COMMIT_GRAPH_ROW_HEIGHT + 2;
  const sweep = Math.abs(targetX - sourceX);
  const fanOffset = (curveIndex - (curveCount - 1) / 2) * 0.75;
  const startX = sourceX + fanOffset;
  const startY = COMMIT_GRAPH_MID_Y + sourceGap;
  const controlY1 =
    startY + (sweep > COMMIT_GRAPH_LANE_GAP ? 3.35 : 3.8);
  const controlY2 =
    bottomY - (sweep > COMMIT_GRAPH_LANE_GAP ? 5.15 : 4.65) +
    curveIndex * 0.22;

  return `M ${startX} ${startY} C ${startX} ${controlY1}, ${targetX} ${controlY2}, ${targetX} ${bottomY}`;
}

function commitGraphThroughPath(sourceX: number, targetX: number) {
  const bottomY = COMMIT_GRAPH_ROW_HEIGHT + 2;

  return `M ${sourceX} ${COMMIT_GRAPH_MID_Y} C ${sourceX} 18.85, ${targetX} 25.55, ${targetX} ${bottomY}`;
}

function commitGraphColor(colorKey: string) {
  const colors = [
    "oklch(49% 0.108 255)",
    "oklch(49% 0.105 152)",
    "oklch(51% 0.112 42)",
    "oklch(50% 0.108 332)",
    "oklch(49% 0.104 286)",
    "oklch(50% 0.095 205)",
    "oklch(49% 0.112 25)",
    "oklch(51% 0.096 110)",
  ];
  const laneColorMatch = /^lane-(\d+)$/.exec(colorKey);
  if (laneColorMatch) {
    return colors[Number(laneColorMatch[1]) % colors.length];
  }

  let hash = 0;
  for (let index = 0; index < colorKey.length; index += 1) {
    hash = (hash * 31 + colorKey.charCodeAt(index)) >>> 0;
  }

  return colors[hash % colors.length];
}
