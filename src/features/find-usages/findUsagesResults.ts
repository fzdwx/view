import type { FileSearchResult } from "../../lib/api";

export interface FindUsagesFileGroup {
  readonly path: string;
  readonly startIndex: number;
  readonly results: readonly FileSearchResult[];
}

export function groupFindUsagesResults(
  results: readonly FileSearchResult[],
): readonly FindUsagesFileGroup[] {
  const groups: FindUsagesFileGroup[] = [];
  let currentPath: string | null = null;
  let currentResults: FileSearchResult[] = [];
  let currentStartIndex = 0;

  results.forEach((result, index) => {
    if (currentPath === result.path) {
      currentResults.push(result);
      return;
    }

    if (currentPath) {
      groups.push({
        path: currentPath,
        startIndex: currentStartIndex,
        results: currentResults,
      });
    }

    currentPath = result.path;
    currentStartIndex = index;
    currentResults = [result];
  });

  if (currentPath) {
    groups.push({
      path: currentPath,
      startIndex: currentStartIndex,
      results: currentResults,
    });
  }

  return groups;
}

export function findUsagesResultKey(
  result: FileSearchResult,
  index: number,
): string {
  return `${result.path}:${result.lineNumber ?? "file"}:${result.matchRanges
    .map(([start, end]) => `${start}-${end}`)
    .join(",")}:${index}`;
}
