import {
  isTerminalPreviewTab,
  terminalPreviewTabId,
  type PreviewTab,
  type TerminalPreviewTab,
} from "./previewTabs";
import type { PreviewPaneLayout } from "./previewPaneTypes";
import { previewPaneTabs } from "./previewPaneActions";

export interface TerminalPreviewTabLifecycle {
  readonly close: (projectPath: string, terminalTabId: string) => void;
  readonly restore: (projectPath: string, terminalTabId: string) => void;
}

export function createTerminalPreviewTab(
  projectPath: string,
  terminalTabId: string,
  title: string,
): TerminalPreviewTab {
  return {
    id: terminalPreviewTabId(projectPath, terminalTabId),
    mode: "terminal",
    path: title,
    commit: null,
    projectPath,
    terminalTabId,
  };
}

export function closeTerminalPreviewTabs(
  tabs: readonly PreviewTab[],
  lifecycle: TerminalPreviewTabLifecycle,
): void {
  for (const tab of tabs) {
    if (isTerminalPreviewTab(tab)) {
      lifecycle.close(tab.projectPath, tab.terminalTabId);
    }
  }
}

export function restoreTerminalPreviewTabs(
  layout: PreviewPaneLayout,
  lifecycle: TerminalPreviewTabLifecycle,
): void {
  for (const tab of previewPaneTabs(layout)) {
    if (isTerminalPreviewTab(tab)) {
      lifecycle.restore(tab.projectPath, tab.terminalTabId);
    }
  }
}
