import { useCallback, useMemo, useRef, useState } from "react";
import { editorDraftKey, isDraftDirty } from "../lib/editorDrafts";
import type { EditorDraft } from "../lib/editorTypes";
import {
  type PreviewMode,
  type PreviewTab,
  type PreviewTarget,
  previewTabId,
} from "../lib/previewTabs";

export interface UsePreviewTabsOptions {
  readonly activeCommit: string | null;
  readonly activeProjectPath: string | null;
  readonly editorDrafts: Record<string, EditorDraft>;
  readonly selectedProjectPath: string | null;
  readonly onDiscardDraft: (key: string) => void;
  readonly onSelectChangePath: (path: string | null) => void;
  readonly onSelectCommit: (commit: string | null) => void;
  readonly onSelectProjectPath: (path: string | null) => void;
}

export interface PreviewTabsController {
  readonly activePreviewTabId: string | null;
  readonly dirtyPreviewTabIds: Set<string>;
  readonly previewMode: PreviewMode;
  readonly previewTabs: PreviewTab[];
  readonly previewTarget: PreviewTarget | null;
  readonly activatePreviewTab: (tab: PreviewTab) => void;
  readonly clearPreviewTabs: (mode?: PreviewMode) => void;
  readonly closePreviewTab: (tabId: string) => void;
  readonly movePreviewTabPath: (fromPath: string, toPath: string) => void;
  readonly openPreviewTab: (
    mode: PreviewMode,
    path: string,
    targetLine?: number | null,
  ) => void;
  readonly removePreviewTabsForPath: (path: string) => void;
  readonly showDiffSelection: () => void;
}

export function usePreviewTabs({
  activeCommit,
  activeProjectPath,
  editorDrafts,
  selectedProjectPath,
  onDiscardDraft,
  onSelectChangePath,
  onSelectCommit,
  onSelectProjectPath,
}: UsePreviewTabsOptions): PreviewTabsController {
  const [previewMode, setPreviewMode] = useState<PreviewMode>("file");
  const [previewTabs, setPreviewTabs] = useState<PreviewTab[]>([]);
  const [activePreviewTabId, setActivePreviewTabId] = useState<string | null>(
    null,
  );
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const previewRequestIdRef = useRef(0);

  const dirtyPreviewTabIds = useMemo(() => {
    if (!activeProjectPath) {
      return new Set<string>();
    }

    return new Set(
      previewTabs
        .filter(
          (tab) =>
            tab.mode === "file" &&
            isDraftDirty(editorDrafts[editorDraftKey(activeProjectPath, tab.path)]),
        )
        .map((tab) => tab.id),
    );
  }, [activeProjectPath, editorDrafts, previewTabs]);

  const activatePreviewTab = useCallback(
    (tab: PreviewTab) => {
      setActivePreviewTabId(tab.id);
      setPreviewMode(tab.mode);
      setPreviewTarget(null);

      if (tab.mode === "file") {
        onSelectProjectPath(tab.path);
        onSelectChangePath(null);
        return;
      }

      onSelectProjectPath(null);
      onSelectCommit(tab.commit);
      onSelectChangePath(tab.path);
    },
    [onSelectChangePath, onSelectCommit, onSelectProjectPath],
  );

  const clearPreviewTabs = useCallback((mode: PreviewMode = "file") => {
    setPreviewTabs([]);
    setActivePreviewTabId(null);
    setPreviewTarget(null);
    setPreviewMode(mode);
  }, []);

  const showDiffSelection = useCallback(() => {
    setPreviewMode("diff");
    setActivePreviewTabId(null);
    setPreviewTarget(null);
  }, []);

  const openPreviewTab = useCallback(
    (mode: PreviewMode, path: string, targetLine: number | null = null) => {
      const commit = mode === "diff" ? activeCommit : null;
      const id = previewTabId(mode, path, commit);
      const nextTab: PreviewTab = { id, mode, path, commit };

      setPreviewTabs((tabs) => {
        if (tabs.some((tab) => tab.id === id)) {
          return tabs;
        }
        return [...tabs, nextTab];
      });
      activatePreviewTab(nextTab);
      setPreviewTarget(
        mode === "file" && targetLine
          ? { line: targetLine, requestId: ++previewRequestIdRef.current }
          : null,
      );
    },
    [activatePreviewTab, activeCommit],
  );

  const closePreviewTab = useCallback(
    (tabId: string) => {
      const tab = previewTabs.find((current) => current.id === tabId);
      if (tab?.mode === "file" && activeProjectPath) {
        const key = editorDraftKey(activeProjectPath, tab.path);
        if (isDraftDirty(editorDrafts[key])) {
          const confirmed = window.confirm(
            `Close ${tab.path} and discard unsaved changes?`,
          );
          if (!confirmed) {
            return;
          }
          onDiscardDraft(key);
        }
      }

      const closedIndex = previewTabs.findIndex((tab) => tab.id === tabId);
      const nextTabs = previewTabs.filter((tab) => tab.id !== tabId);
      setPreviewTabs(nextTabs);

      if (activePreviewTabId !== tabId) {
        return;
      }

      const nextTab =
        nextTabs[Math.max(0, closedIndex - 1)] ?? nextTabs[0] ?? null;
      if (nextTab) {
        activatePreviewTab(nextTab);
        return;
      }

      setActivePreviewTabId(null);
      onSelectProjectPath(null);
      onSelectChangePath(null);
      setPreviewMode("file");
      setPreviewTarget(null);
    },
    [
      activePreviewTabId,
      activeProjectPath,
      activatePreviewTab,
      editorDrafts,
      onDiscardDraft,
      onSelectChangePath,
      onSelectProjectPath,
      previewTabs,
    ],
  );

  const movePreviewTabPath = useCallback(
    (fromPath: string, toPath: string) => {
      const fromTabId = previewTabId("file", fromPath, null);
      const toTabId = previewTabId("file", toPath, null);
      setPreviewTabs((tabs) =>
        tabs.map((tab) =>
          tab.mode === "file" && tab.path === fromPath
            ? { ...tab, id: toTabId, path: toPath }
            : tab,
        ),
      );
      if (activePreviewTabId === fromTabId) {
        setActivePreviewTabId(toTabId);
      }
    },
    [activePreviewTabId],
  );

  const removePreviewTabsForPath = useCallback(
    (path: string) => {
      const removedTabIds = new Set(
        previewTabs
          .filter((tab) => tab.mode === "file" && tab.path === path)
          .map((tab) => tab.id),
      );
      if (removedTabIds.size === 0) {
        return;
      }

      const removedIndex = previewTabs.findIndex((tab) =>
        removedTabIds.has(tab.id),
      );
      const nextTabs = previewTabs.filter((tab) => !removedTabIds.has(tab.id));
      setPreviewTabs(nextTabs);
      if (activePreviewTabId && removedTabIds.has(activePreviewTabId)) {
        const nextTab =
          nextTabs[Math.max(0, removedIndex - 1)] ?? nextTabs[0] ?? null;
        if (nextTab) {
          activatePreviewTab(nextTab);
          return;
        }

        setActivePreviewTabId(null);
        onSelectProjectPath(null);
        onSelectChangePath(null);
        setPreviewMode("file");
        setPreviewTarget(null);
        return;
      }

      if (selectedProjectPath === path) {
        onSelectProjectPath(null);
      }
    },
    [
      activePreviewTabId,
      activatePreviewTab,
      onSelectChangePath,
      onSelectProjectPath,
      previewTabs,
      selectedProjectPath,
    ],
  );

  return {
    activePreviewTabId,
    dirtyPreviewTabIds,
    previewMode,
    previewTabs,
    previewTarget,
    activatePreviewTab,
    clearPreviewTabs,
    closePreviewTab,
    movePreviewTabPath,
    openPreviewTab,
    removePreviewTabsForPath,
    showDiffSelection,
  };
}
