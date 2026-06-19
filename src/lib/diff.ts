import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";


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
