import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import type { GitStatus, TreeFile } from "./api";

export interface ParsedRepositoryDiff {
  error: string | null;
  files: FileDiffMetadata[];
}

export function parseRepositoryDiff(diff: string): ParsedRepositoryDiff {
  if (!diff.trim()) {
    return { error: null, files: [] };
  }

  try {
    return {
      error: null,
      files: parsePatchFiles(diff).flatMap((patch) => patch.files),
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      files: [],
    };
  }
}

export function toDiffTreeFiles(files: FileDiffMetadata[]): TreeFile[] {
  return files.map((file) => ({
    path: file.name,
    status: changeTypeToStatus(file.type),
  }));
}

export function filterDiffFiles(
  files: FileDiffMetadata[],
  selectedPath: string | null,
): FileDiffMetadata[] {
  if (!selectedPath) {
    return files;
  }

  return files.filter(
    (file) => file.name === selectedPath || file.prevName === selectedPath,
  );
}

export function countDiffStats(files: readonly FileDiffMetadata[]) {
  return files.reduce(
    (total, file) => {
      for (const hunk of file.hunks) {
        total.additions += hunk.additionLines;
        total.deletions += hunk.deletionLines;
      }
      total.files += 1;
      return total;
    },
    { additions: 0, deletions: 0, files: 0 },
  );
}

function changeTypeToStatus(changeType: FileDiffMetadata["type"]): GitStatus {
  switch (changeType) {
    case "new":
      return "added";
    case "deleted":
      return "deleted";
    case "rename-changed":
    case "rename-pure":
      return "renamed";
    case "change":
    default:
      return "modified";
  }
}
