import type { TreeFile } from "./api";

export function treeFilesSignature(files: readonly TreeFile[]): string {
  return files
    .map(
      (file) =>
        `${file.path}\u0000${file.status ?? ""}\u0000${file.oldPath ?? ""}\u0000${file.indexStatus ?? ""}\u0000${file.worktreeStatus ?? ""}`,
    )
    .join("\u0001");
}
