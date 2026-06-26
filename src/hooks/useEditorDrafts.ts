import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isTauriRuntime, saveFileContent } from "../lib/api";
import {
  countDirtyDrafts,
  countDirtyDraftsForProject,
  editorDraftKey,
  isDraftDirty,
  omitDraft,
  omitDraftsForProject,
} from "../lib/editorDrafts";
import type { EditorDraft } from "../lib/editorTypes";

export interface UseEditorDraftsOptions {
  readonly activeProjectPath: string | null;
  readonly selectedProjectPath: string | null;
  readonly onFileSaved: (projectPath: string, filePath: string) => Promise<void>;
}

export interface EditorDraftsController {
  readonly activeEditorDraft: EditorDraft | null;
  readonly dirtyDraftCount: number;
  readonly editorDrafts: Record<string, EditorDraft>;
  readonly editorKey: string | null;
  readonly saveError: string | null;
  readonly savingActiveFile: boolean;
  readonly confirmDiscardProjectDrafts: (
    projectPath: string,
    action: string,
  ) => boolean;
  readonly discardConflictToDisk: () => void;
  readonly discardDraftByKey: (key: string) => void;
  readonly discardDraftForPath: (projectPath: string, filePath: string) => void;
  readonly discardDraftsForProject: (projectPath: string) => void;
  readonly isFileDraftDirty: (projectPath: string, filePath: string) => boolean;
  readonly moveEditorDraftPath: (
    projectPath: string,
    fromPath: string,
    toPath: string,
  ) => void;
  readonly saveActiveFile: () => Promise<boolean>;
  readonly setConflictDraftContent: (content: string) => void;
  readonly updateEditorDraftForFile: (
    projectPath: string,
    filePath: string,
    baseContent: string,
    content: string,
  ) => void;
}

export function useEditorDrafts({
  activeProjectPath,
  selectedProjectPath,
  onFileSaved,
}: UseEditorDraftsOptions): EditorDraftsController {
  const [editorDrafts, setEditorDrafts] = useState<Record<string, EditorDraft>>(
    {},
  );
  const [savePendingKeys, setSavePendingKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [saveErrorEntry, setSaveErrorEntry] = useState<{
    forEditorKey: string | null;
    message: string | null;
  }>({ forEditorKey: null, message: null });
  const editorKey =
    activeProjectPath && selectedProjectPath
      ? editorDraftKey(activeProjectPath, selectedProjectPath)
      : null;
  const saveError =
    saveErrorEntry.forEditorKey === editorKey ? saveErrorEntry.message : null;
  const setSaveError = useCallback(
    (message: string | null) =>
      setSaveErrorEntry({ forEditorKey: editorKey, message }),
    [editorKey],
  );
  const activeEditorDraft = editorKey ? editorDrafts[editorKey] ?? null : null;
  const dirtyDraftCount = useMemo(
    () => countDirtyDrafts(editorDrafts),
    [editorDrafts],
  );
  const savingActiveFile = Boolean(editorKey && savePendingKeys.has(editorKey));

  useEffect(() => {
    if (dirtyDraftCount === 0) {
      return;
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirtyDraftCount]);

  useEffect(() => {
    if (!isTauriRuntime() || dirtyDraftCount === 0) {
      return;
    }

    let unlisten: (() => void) | null = null;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (
          countDirtyDrafts(editorDrafts) > 0 &&
          !window.confirm(
            "You have unsaved file changes. Close View and discard them?",
          )
        ) {
          event.preventDefault();
        }
      })
      .then((nextUnlisten) => {
        unlisten = nextUnlisten;
      });

    return () => {
      unlisten?.();
    };
  }, [dirtyDraftCount, editorDrafts]);

  const discardDraftByKey = useCallback((key: string) => {
    setEditorDrafts((current) => omitDraft(current, key));
  }, []);

  const discardDraftForPath = useCallback(
    (projectPath: string, filePath: string) => {
      setEditorDrafts((current) =>
        omitDraft(current, editorDraftKey(projectPath, filePath)),
      );
    },
    [],
  );

  const discardDraftsForProject = useCallback((projectPath: string) => {
    setEditorDrafts((current) => omitDraftsForProject(current, projectPath));
  }, []);

  const isFileDraftDirty = useCallback(
    (projectPath: string, filePath: string) =>
      isDraftDirty(editorDrafts[editorDraftKey(projectPath, filePath)]),
    [editorDrafts],
  );

  const moveEditorDraftPath = useCallback(
    (projectPath: string, fromPath: string, toPath: string) => {
      const fromKey = editorDraftKey(projectPath, fromPath);
      const toKey = editorDraftKey(projectPath, toPath);
      setEditorDrafts((current) => {
        const draft = current[fromKey];
        if (!draft) {
          return current;
        }
        const { [fromKey]: _removed, ...remaining } = current;
        return {
          ...remaining,
          [toKey]: draft,
        };
      });
    },
    [],
  );

  const updateEditorDraftForFile = useCallback(
    (
      projectPath: string,
      filePath: string,
      baseContent: string,
      content: string,
    ) => {
      const key = editorDraftKey(projectPath, filePath);
      setEditorDrafts((current) => {
        const existing = current[key];
        const existingIsStaleCleanDraft = Boolean(
          existing &&
            !existing.conflict &&
            existing.content === existing.baseContent &&
            existing.baseContent !== baseContent,
        );
        const draft =
          existing && !existingIsStaleCleanDraft
            ? existing
            : {
                baseContent,
                content: baseContent,
                conflict: null,
              };

        if (draft.content === content) {
          return current;
        }

        return {
          ...current,
          [key]: {
            ...draft,
            content,
          },
        };
      });
      setSaveError(null);
    },
    [setSaveError],
  );

  const setConflictDraftContent = useCallback(
    (content: string) => {
      if (!editorKey) {
        return;
      }

      setEditorDrafts((current) => {
        const existing = current[editorKey];
        if (!existing) {
          return current;
        }

        return {
          ...current,
          [editorKey]: {
            ...existing,
            content,
          },
        };
      });
      setSaveError(null);
    },
    [editorKey, setSaveError],
  );

  const saveActiveFile = useCallback(async () => {
    if (
      !activeProjectPath ||
      !selectedProjectPath ||
      !editorKey ||
      savePendingKeys.has(editorKey)
    ) {
      return false;
    }

    const draft = editorDrafts[editorKey];
    if (!draft) {
      return true;
    }

    setSavePendingKeys((current) => new Set(current).add(editorKey));
    setSaveError(null);
    try {
      const baseContent = draft.conflict
        ? draft.conflict.currentContent
        : draft.baseContent;
      const response = await saveFileContent(
        activeProjectPath,
        selectedProjectPath,
        baseContent,
        draft.content,
      );

      if (response.status === "conflict" && response.conflict) {
        const conflict = response.conflict;
        setEditorDrafts((current) => {
          const latest = current[editorKey];
          if (!latest) {
            return current;
          }
          const hasNewerContent = latest.content !== draft.content;
          const proposedContent = hasNewerContent
            ? latest.content
            : conflict.proposedContent;
          return {
            ...current,
            [editorKey]: {
              baseContent: conflict.baseContent,
              content: proposedContent,
              conflict: {
                ...conflict,
                proposedContent,
              },
            },
          };
        });
        return false;
      }

      if (response.file) {
        const file = response.file;
        setEditorDrafts((current) => {
          const latest = current[editorKey];
          if (!latest) {
            return current;
          }
          const hasNewerContent = latest.content !== draft.content;
          return {
            ...current,
            [editorKey]: {
              baseContent: file.content,
              content: hasNewerContent ? latest.content : file.content,
              conflict: null,
            },
          };
        });
        await onFileSaved(activeProjectPath, selectedProjectPath);
        return true;
      }
      return false;
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setSavePendingKeys((current) => {
        if (!current.has(editorKey)) {
          return current;
        }
        const next = new Set(current);
        next.delete(editorKey);
        return next;
      });
    }
  }, [
    activeProjectPath,
    editorDrafts,
    editorKey,
    onFileSaved,
    savePendingKeys,
    selectedProjectPath,
    setSaveError,
  ]);

  const discardConflictToDisk = useCallback(() => {
    if (!editorKey) {
      return;
    }

    setEditorDrafts((current) => {
      const existing = current[editorKey];
      if (!existing?.conflict) {
        return current;
      }

      return {
        ...current,
        [editorKey]: {
          baseContent: existing.conflict.currentContent,
          content: existing.conflict.currentContent,
          conflict: null,
        },
      };
    });
    setSaveError(null);
  }, [editorKey, setSaveError]);

  const confirmDiscardProjectDrafts = useCallback(
    (projectPath: string, action: string): boolean => {
      const dirtyCount = countDirtyDraftsForProject(editorDrafts, projectPath);
      if (dirtyCount === 0) {
        return true;
      }

      return window.confirm(
        `${dirtyCount} file${dirtyCount > 1 ? "s have" : " has"} unsaved changes. Continue to ${action} and discard them?`,
      );
    },
    [editorDrafts],
  );

  return {
    activeEditorDraft,
    dirtyDraftCount,
    editorDrafts,
    editorKey,
    saveError,
    savingActiveFile,
    confirmDiscardProjectDrafts,
    discardConflictToDisk,
    discardDraftByKey,
    discardDraftForPath,
    discardDraftsForProject,
    isFileDraftDirty,
    moveEditorDraftPath,
    saveActiveFile,
    setConflictDraftContent,
    updateEditorDraftForFile,
  };
}
