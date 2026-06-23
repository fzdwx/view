export type PreviewMode = "file" | "diff" | "terminal";
export type FilePreviewMode = "file" | "diff";

interface PreviewTabBase {
  readonly id: string;
  readonly path: string;
  readonly commit: string | null;
}

export interface FilePreviewTab extends PreviewTabBase {
  readonly mode: "file";
}

export interface DiffPreviewTab extends PreviewTabBase {
  readonly mode: "diff";
}

export interface TerminalPreviewTab extends PreviewTabBase {
  readonly mode: "terminal";
  readonly projectPath: string;
  readonly terminalTabId: string;
}

export type PreviewTab = FilePreviewTab | DiffPreviewTab | TerminalPreviewTab;

export interface PreviewTarget {
  line: number;
  column: number;
  requestId: number;
}

export function previewTabId(
  mode: PreviewMode,
  path: string,
  commit: string | null,
): string {
  return `${mode}:${commit ?? "worktree"}:${path}`;
}

export function terminalPreviewTabId(
  projectPath: string,
  terminalTabId: string,
): string {
  return `terminal:${projectPath}:${terminalTabId}`;
}

export function isTerminalPreviewTab(
  tab: PreviewTab | null,
): tab is TerminalPreviewTab {
  return tab?.mode === "terminal";
}
