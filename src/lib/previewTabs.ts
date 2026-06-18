export type PreviewMode = "file" | "diff";

export interface PreviewTab {
  id: string;
  mode: PreviewMode;
  path: string;
  commit: string | null;
}

export interface PreviewTarget {
  line: number;
  requestId: number;
}

export function previewTabId(
  mode: PreviewMode,
  path: string,
  commit: string | null,
): string {
  return `${mode}:${commit ?? "worktree"}:${path}`;
}
