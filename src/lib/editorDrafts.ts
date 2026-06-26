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
  const lines = content.split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    if (!isConflictStartLine(lines[index])) {
      index += 1;
      continue;
    }

    index += 1;
    while (
      index < lines.length &&
      !isConflictSeparatorLine(lines[index]) &&
      !isConflictStartLine(lines[index])
    ) {
      index += 1;
    }

    if (index >= lines.length || !isConflictSeparatorLine(lines[index])) {
      continue;
    }

    index += 1;
    while (index < lines.length && !isConflictEndLine(lines[index])) {
      index += 1;
    }

    if (index < lines.length && isConflictEndLine(lines[index])) {
      return true;
    }
  }

  return false;
}

export type GitConflictResolutionStrategy = "ours" | "theirs" | "both";

export function resolveGitConflictMarkers(
  content: string,
  strategy: GitConflictResolutionStrategy,
): string {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const hadTrailingNewline = content.endsWith("\n");
  const lines = content.split(/\r?\n/);
  if (hadTrailingNewline) {
    lines.pop();
  }

  const resolved: string[] = [];
  let index = 0;

  while (index < lines.length) {
    if (!isConflictStartLine(lines[index])) {
      resolved.push(lines[index]);
      index += 1;
      continue;
    }

    const parsed = parseConflictBlock(lines, index);
    if (!parsed) {
      resolved.push(lines[index]);
      index += 1;
      continue;
    }

    if (strategy === "ours" || strategy === "both") {
      resolved.push(...parsed.ours);
    }
    if (strategy === "theirs" || strategy === "both") {
      resolved.push(...parsed.theirs);
    }
    index = parsed.nextIndex;
  }

  const value = resolved.join(newline);
  return hadTrailingNewline ? `${value}${newline}` : value;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function isConflictStartLine(line: string): boolean {
  return line.startsWith("<<<<<<< ") && !line.slice(8).includes("<<<<<<<");
}

function isConflictSeparatorLine(line: string): boolean {
  return line === "=======";
}

function isConflictEndLine(line: string): boolean {
  return line.startsWith(">>>>>>> ") && !line.slice(8).includes(">>>>>>>");
}

function isConflictBaseLine(line: string): boolean {
  return line.startsWith("||||||| ") && !line.slice(8).includes("|||||||");
}

function parseConflictBlock(
  lines: readonly string[],
  startIndex: number,
): { readonly ours: readonly string[]; readonly theirs: readonly string[]; readonly nextIndex: number } | null {
  const ours: string[] = [];
  const theirs: string[] = [];
  let index = startIndex + 1;
  let readingBase = false;

  while (index < lines.length) {
    const line = lines[index];
    if (isConflictBaseLine(line)) {
      readingBase = true;
      index += 1;
      continue;
    }
    if (isConflictSeparatorLine(line)) {
      index += 1;
      break;
    }
    if (!readingBase) {
      ours.push(line);
    }
    index += 1;
  }

  if (index >= lines.length) {
    return null;
  }

  while (index < lines.length && !isConflictEndLine(lines[index])) {
    theirs.push(lines[index]);
    index += 1;
  }

  if (index >= lines.length || !isConflictEndLine(lines[index])) {
    return null;
  }

  return { ours, theirs, nextIndex: index + 1 };
}
