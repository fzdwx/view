import type { EditorDraft } from "../lib/editorTypes";
import type {
  PreviewPane,
  PreviewPaneId,
  PreviewPaneLayout,
  PreviewSplitDirection,
} from "../lib/previewPanes";
import type {
  FilePreviewMode,
  PreviewMode,
  PreviewTab,
  PreviewTarget,
} from "../lib/previewTabs";

export interface UsePreviewPanesOptions {
  readonly activeCommit: string | null;
  readonly activeProjectPath: string | null;
  readonly editorDrafts: Record<string, EditorDraft>;
  readonly onCloseTerminalTab: (projectPath: string, terminalTabId: string) => void;
  readonly onDiscardDraft: (key: string) => void;
  readonly onRestoreTerminalTab: (projectPath: string, terminalTabId: string) => void;
  readonly onSelectChangePath: (path: string | null) => void;
  readonly onSelectCommit: (commit: string | null) => void;
  readonly onSelectProjectPath: (path: string | null) => void;
}

export interface PreviewPanesController {
  readonly activePane: PreviewPane | null;
  readonly activePaneId: PreviewPaneId;
  readonly activePreviewTab: PreviewTab | null;
  readonly activePreviewTabId: string | null;
  readonly dirtyPreviewTabIds: Set<string>;
  readonly layout: PreviewPaneLayout;
  readonly previewMode: PreviewMode;
  readonly previewTabs: readonly PreviewTab[];
  readonly previewTarget: PreviewTarget | null;
  readonly activateAdjacentTab: (direction: 1 | -1) => void;
  readonly activatePane: (paneId: PreviewPaneId) => void;
  readonly activatePreviewTab: (paneId: PreviewPaneId, tab: PreviewTab) => void;
  readonly clearPreviewTabs: (mode?: PreviewMode) => void;
  readonly closeAllTabs: (paneId: PreviewPaneId) => void;
  readonly closeOtherTabs: (paneId: PreviewPaneId, keepTabId: string) => void;
  readonly closePreviewTab: (paneId: PreviewPaneId, tabId: string) => void;
  readonly closeActivePreviewTab: () => void;
  readonly movePreviewTabPath: (fromPath: string, toPath: string) => void;
  readonly openPreviewTab: (
    mode: FilePreviewMode,
    path: string,
    targetLine?: number | null,
    targetColumn?: number | null,
  ) => void;
  readonly openTerminalTab: (
    paneId: PreviewPaneId,
    projectPath: string,
    terminalTabId: string,
    title: string,
  ) => void;
  readonly removePreviewTabsForPath: (path: string) => void;
  readonly reorderPreviewTabs: (
    paneId: PreviewPaneId,
    fromId: string,
    toId: string,
  ) => void;
  readonly showDiffSelection: () => void;
  readonly splitTab: (
    paneId: PreviewPaneId,
    tabId: string,
    direction: PreviewSplitDirection,
  ) => void;
}
