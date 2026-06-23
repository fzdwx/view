import { saveFileContent } from "../lib/api";
import { editorDraftKey, isDraftDirty } from "../lib/editorDrafts";
import type { EditorDraft } from "../lib/editorTypes";
import { confirmNativeDialog, showNativeMessage } from "../lib/nativeDialogs";

export interface SaveDirtyDraftBeforeStageOptions {
  readonly discardDraftForPath: (projectPath: string, filePath: string) => void;
  readonly editorDrafts: Record<string, EditorDraft>;
  readonly filePath: string;
  readonly projectPath: string;
  readonly refreshProjectFileState: (projectPath: string) => Promise<void>;
}

export async function saveDirtyDraftBeforeStage({
  discardDraftForPath,
  editorDrafts,
  filePath,
  projectPath,
  refreshProjectFileState,
}: SaveDirtyDraftBeforeStageOptions): Promise<boolean> {
  const draft = editorDrafts[editorDraftKey(projectPath, filePath)];
  if (!isDraftDirty(draft)) {
    return true;
  }

  const confirmed = await confirmNativeDialog(
    `${filePath} has unsaved editor changes. Save it before staging?`,
    {
      cancelLabel: "Cancel",
      kind: "warning",
      okLabel: "Save",
    },
  );
  if (!confirmed) {
    return false;
  }

  const baseContent = draft.conflict
    ? draft.conflict.currentContent
    : draft.baseContent;
  const response = await saveFileContent(
    projectPath,
    filePath,
    baseContent,
    draft.content,
  );

  if (response.status === "conflict") {
    await refreshProjectFileState(projectPath);
    await showNativeMessage(
      `${filePath} changed on disk. Resolve the save conflict before staging.`,
      { kind: "warning" },
    );
    return false;
  }

  discardDraftForPath(projectPath, filePath);
  return true;
}
