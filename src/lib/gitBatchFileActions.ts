import type { TreeFile } from "./api";

export function stageableFilePaths(files: readonly TreeFile[]): string[] {
  return uniqueChangedPaths(files, isStageableFile);
}

export function unstageableFilePaths(files: readonly TreeFile[]): string[] {
  return uniqueChangedPaths(files, isUnstageableFile);
}

function uniqueChangedPaths(
  files: readonly TreeFile[],
  predicate: (file: TreeFile) => boolean,
): string[] {
  const seenPaths = new Set<string>();
  const paths: string[] = [];

  for (const file of files) {
    if (!predicate(file) || seenPaths.has(file.path)) {
      continue;
    }
    seenPaths.add(file.path);
    paths.push(file.path);
  }

  return paths;
}

function isStageableFile(file: TreeFile): boolean {
  return (
    !isConflictFile(file) &&
    (file.unstaged === true ||
      file.untracked === true ||
      (file.deleted === true && file.worktreeStatus === "D"))
  );
}

function isUnstageableFile(file: TreeFile): boolean {
  return !isConflictFile(file) && file.staged === true;
}

function isConflictFile(file: TreeFile): boolean {
  return file.conflict === true || file.status === "conflict";
}
