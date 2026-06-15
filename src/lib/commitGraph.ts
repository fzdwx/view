import type { CommitInfo } from "./api";

export interface CommitGraphLane {
  index: number;
  colorKey: string;
}

export interface CommitGraphParentLane {
  index: number;
  colorKey: string;
}

export interface CommitGraphThroughLane {
  fromIndex: number;
  toIndex: number;
  colorKey: string;
}

export interface CommitGraphRow {
  commit: CommitInfo;
  lane: number;
  colorKey: string;
  laneCount: number;
  beforeLanes: CommitGraphLane[];
  afterLanes: CommitGraphLane[];
  parentLanes: CommitGraphParentLane[];
  throughLanes: CommitGraphThroughLane[];
}

export function buildCommitGraph(commits: CommitInfo[]): CommitGraphRow[] {
  const visibleHashes = new Set(commits.map((commit) => commit.hash));
  const lanes: string[] = [];
  const laneColorKeys: string[] = [];
  let nextColorIndex = 0;
  const nextColorKey = () => `lane-${nextColorIndex++}`;

  return commits.map((commit) => {
    let lane = lanes.indexOf(commit.hash);
    const laneExisted = lane !== -1;
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(commit.hash);
      laneColorKeys.push(nextColorKey());
    }

    const colorKey = laneColorKeys[lane] ?? commit.hash;
    const beforeLaneEntries = lanes.map((hash, index) => ({
      hash,
      index,
      colorKey: laneColorKeys[index] ?? lanes[index],
    }));
    const beforeLanes = beforeLaneEntries
      .map((laneEntry) => ({
        index: laneEntry.index,
        colorKey: laneEntry.colorKey,
      }))
      .filter((beforeLane) => laneExisted || beforeLane.index !== lane);
    const visibleParents = commit.parents.filter((parent) =>
      visibleHashes.has(parent),
    );
    const nextLanes = [...lanes];
    const nextLaneColorKeys = [...laneColorKeys];
    const parentLanes: CommitGraphParentLane[] = [];

    if (visibleParents.length === 0) {
      nextLanes.splice(lane, 1);
      nextLaneColorKeys.splice(lane, 1);
    } else {
      const firstParent = visibleParents[0];
      const existingFirstParentLane = nextLanes.findIndex(
        (hash, index) => index !== lane && hash === firstParent,
      );
      if (existingFirstParentLane === -1) {
        nextLanes[lane] = firstParent;
        nextLaneColorKeys[lane] = colorKey;
        parentLanes.push({ index: lane, colorKey });
      } else {
        const targetLane =
          existingFirstParentLane > lane
            ? existingFirstParentLane - 1
            : existingFirstParentLane;
        nextLanes.splice(lane, 1);
        nextLaneColorKeys.splice(lane, 1);
        parentLanes.push({ index: targetLane, colorKey });
      }

      visibleParents.slice(1).forEach((parent, offset) => {
        const existingLane = nextLanes.indexOf(parent);
        if (existingLane === -1) {
          const insertAt = Math.min(lane + offset + 1, nextLanes.length);
          nextLanes.splice(insertAt, 0, parent);
          const parentColorKey = nextColorKey();
          nextLaneColorKeys.splice(insertAt, 0, parentColorKey);
          parentLanes.push({ index: insertAt, colorKey: parentColorKey });
        } else {
          parentLanes.push({
            index: existingLane,
            colorKey: nextLaneColorKeys[existingLane] ?? parent,
          });
        }
      });
    }

    const visibleParentSet = new Set(visibleParents);
    const shiftedLaneKeys = new Set<string>();
    const throughLanes = beforeLaneEntries.flatMap((beforeLane) => {
      const nextIndex = nextLanes.indexOf(beforeLane.hash);
      if (
        nextIndex === -1 ||
        nextIndex === beforeLane.index ||
        visibleParentSet.has(beforeLane.hash)
      ) {
        return [];
      }

      shiftedLaneKeys.add(beforeLane.hash);
      return [
        {
          fromIndex: beforeLane.index,
          toIndex: nextIndex,
          colorKey: beforeLane.colorKey,
        },
      ];
    });

    lanes.splice(0, lanes.length, ...nextLanes);
    laneColorKeys.splice(0, laneColorKeys.length, ...nextLaneColorKeys);
    const afterLanes = lanes
      .map((hash, index) => ({
        hash,
        index,
        colorKey: laneColorKeys[index] ?? lanes[index],
      }))
      .filter((afterLane) => !shiftedLaneKeys.has(afterLane.hash))
      .map((afterLane) => ({
        index: afterLane.index,
        colorKey: afterLane.colorKey,
      }));

    return {
      commit,
      lane,
      colorKey,
      laneCount: Math.max(
        beforeLanes.length,
        afterLanes.length,
        ...parentLanes.map((parentLane) => parentLane.index + 1),
        ...throughLanes.map((throughLane) =>
          Math.max(throughLane.fromIndex, throughLane.toIndex) + 1,
        ),
        lane + 1,
        1,
      ),
      beforeLanes,
      afterLanes,
      parentLanes,
      throughLanes,
    };
  });
}
