import { useCallback, useMemo } from "react";
import { editorDraftKey, isDraftDirty } from "../lib/editorDrafts";
import type { EditorDraft } from "../lib/editorTypes";
import {
  previewPaneTabs,
  type PreviewPaneLayout,
} from "../lib/previewPanes";
import type { PreviewTab } from "../lib/previewTabs";

export function usePreviewPaneDirtyGuard({
  activeProjectPath,
  editorDrafts,
  layout,
  onDiscardDraft,
}: {
  readonly activeProjectPath: string | null;
  readonly editorDrafts: Record<string, EditorDraft>;
  readonly layout: PreviewPaneLayout;
  readonly onDiscardDraft: (key: string) => void;
}) {
  const dirtyPreviewTabIds = useMemo(() => {
    if (!activeProjectPath) {
      return new Set<string>();
    }

    return previewPaneTabs(layout).reduce<Set<string>>((ids, tab) => {
      if (
        tab.mode === "file" &&
        isDraftDirty(editorDrafts[editorDraftKey(activeProjectPath, tab.path)])
      ) {
        ids.add(tab.id);
      }
      return ids;
    }, new Set());
  }, [activeProjectPath, editorDrafts, layout]);

  const confirmDiscardClosedDirtyTabs = useCallback(
    (removedTabs: readonly PreviewTab[], nextLayout: PreviewPaneLayout) => {
      if (!activeProjectPath) {
        return true;
      }

      for (const tab of removedTabs) {
        if (tab.mode !== "file" || layoutHasTab(nextLayout, tab.id)) {
          continue;
        }
        const key = editorDraftKey(activeProjectPath, tab.path);
        if (!isDraftDirty(editorDrafts[key])) {
          continue;
        }
        if (!window.confirm(`Close ${tab.path} and discard unsaved changes?`)) {
          return false;
        }
        onDiscardDraft(key);
      }
      return true;
    },
    [activeProjectPath, editorDrafts, onDiscardDraft],
  );

  return { confirmDiscardClosedDirtyTabs, dirtyPreviewTabIds };
}

function layoutHasTab(layout: PreviewPaneLayout, tabId: string): boolean {
  return layout.panes.some((pane) => pane.tabs.some((tab) => tab.id === tabId));
}
