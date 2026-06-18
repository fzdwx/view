import type { FileContents } from "@pierre/diffs";
import type { SaveConflict } from "./api";
import type { EditorDraft } from "./editorTypes";

export function editorDraftKey(projectPath: string, filePath: string): string {
  return `${projectPath}\u0000${filePath}`;
}

export function isDraftDirty(draft: EditorDraft | null | undefined): boolean {
  return Boolean(draft && (draft.conflict || draft.content !== draft.baseContent));
}

export function countDirtyDrafts(drafts: Record<string, EditorDraft>): number {
  return Object.values(drafts).filter(isDraftDirty).length;
}

export function countDirtyDraftsForProject(
  drafts: Record<string, EditorDraft>,
  projectPath: string,
): number {
  const prefix = `${projectPath}\u0000`;
  return Object.entries(drafts).filter(
    ([key, draft]) => key.startsWith(prefix) && isDraftDirty(draft),
  ).length;
}

export function omitDraft(
  drafts: Record<string, EditorDraft>,
  keyToRemove: string,
): Record<string, EditorDraft> {
  const { [keyToRemove]: _removed, ...remaining } = drafts;
  return remaining;
}

export function omitDraftsForProject(
  drafts: Record<string, EditorDraft>,
  projectPath: string,
): Record<string, EditorDraft> {
  const prefix = `${projectPath}\u0000`;
  return Object.fromEntries(
    Object.entries(drafts).filter(([key]) => !key.startsWith(prefix)),
  );
}

export function conflictToMarkerFile(conflict: SaveConflict): FileContents {
  return {
    name: conflict.path,
    contents:
      "<<<<<<< Disk\n" +
      ensureTrailingNewline(conflict.currentContent) +
      "=======\n" +
      ensureTrailingNewline(conflict.proposedContent) +
      ">>>>>>> Your changes\n",
  };
}

export function gitConflictToMarkerFile(
  path: string,
  content: string,
): FileContents {
  return {
    name: path,
    contents: content,
  };
}

export function hasGitConflictMarkers(content: string): boolean {
  return (
    content.includes("<<<<<<<") &&
    content.includes("=======") &&
    content.includes(">>>>>>>")
  );
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
