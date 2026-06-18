import type { EditorGitMarker } from "./editorTypes";

export function revertEditorGitMarker(
  content: string,
  marker: EditorGitMarker,
): string {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const hadTrailingNewline = content.endsWith("\n");
  const lines = content.split(/\r?\n/);
  if (hadTrailingNewline) {
    lines.pop();
  }

  const startIndex = Math.max(0, marker.newStart - 1);
  lines.splice(startIndex, marker.newLineCount, ...marker.oldLines);
  const nextContent = lines.join(newline);
  return hadTrailingNewline || marker.oldLines.length > 0
    ? `${nextContent}${newline}`
    : nextContent;
}

export function filterVisibleEditorGitMarkers(
  markers: readonly EditorGitMarker[],
  content: string,
): EditorGitMarker[] {
  const lines = content.split(/\r?\n/);
  if (content.endsWith("\n")) {
    lines.pop();
  }

  return markers.filter((marker) => {
    const startIndex = Math.max(0, marker.newStart - 1);
    if (marker.newLineCount === 0) {
      return !linesMatchAt(lines, startIndex, marker.oldLines);
    }
    return linesMatchAt(lines, startIndex, marker.newLines);
  });
}

export function utf16OffsetForLine(content: string, lineNumber: number): number {
  if (lineNumber <= 1) {
    return 0;
  }

  let currentLine = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== "\n") {
      continue;
    }
    currentLine += 1;
    if (currentLine === lineNumber) {
      return content.slice(0, index + 1).length;
    }
  }
  return content.length;
}

/**
 * Convert a byte offset within a line to a UTF-16 code unit offset.
 * Rust returns byte offsets; JS strings use UTF-16.
 */
export function byteOffsetToUtf16(line: string, byteOffset: number): number {
  if (byteOffset <= 0) return 0;
  let bytes = 0;
  for (let i = 0; i < line.length; i++) {
    const code = line.charCodeAt(i);
    const charBytes = utf8ByteLength(code, i, line);
    if (bytes >= byteOffset) return i;
    bytes += charBytes;
  }
  return line.length;
}

function utf8ByteLength(code: number, index: number, line: string): number {
  if (code <= 0x7f) return 1;
  if (code <= 0x7ff) return 2;
  // Surrogate pair (4 bytes UTF-8, 2 UTF-16 code units)
  if (code >= 0xd800 && code <= 0xdbff) return 4;
  if (code >= 0xdc00 && code <= 0xdfff) return 0; // low surrogate, already counted
  return 3;
}

export function gitMarkerLabel(kind: EditorGitMarker["kind"]): string {
  switch (kind) {
    case "added":
      return "Added lines";
    case "deleted":
      return "Deleted lines";
    case "modified":
      return "Modified lines";
  }
}

export function buildEditorGitMarkers(diff: string): EditorGitMarker[] {
  if (!diff.trim()) {
    return [];
  }

  const markers: EditorGitMarker[] = [];
  let oldLine = 1;
  let newLine = 1;
  let markerIndex = 0;
  let currentChange:
    | {
        oldStart: number;
        newStart: number;
        oldLines: string[];
        newLines: string[];
        diffLines: string[];
        additions: number;
        deletions: number;
      }
    | null = null;

  const startChange = () => {
    currentChange ??= {
      oldStart: oldLine,
      newStart: newLine,
      oldLines: [],
      newLines: [],
      diffLines: [],
      additions: 0,
      deletions: 0,
    };
    return currentChange;
  };

  const flushChange = () => {
    if (
      !currentChange ||
      (currentChange.additions === 0 && currentChange.deletions === 0)
    ) {
      currentChange = null;
      return;
    }

    const kind =
      currentChange.additions > 0 && currentChange.deletions > 0
        ? "modified"
        : currentChange.additions > 0
          ? "added"
          : "deleted";
    const oldLineCount = currentChange.oldLines.length;
    const newLineCount = currentChange.newLines.length;
    const line = Math.max(1, currentChange.newStart);
    const lineCount = Math.max(1, newLineCount || oldLineCount);
    markers.push({
      id: `${currentChange.oldStart}-${oldLineCount}-${currentChange.newStart}-${newLineCount}-${markerIndex}`,
      line,
      lineCount,
      oldStart: currentChange.oldStart,
      oldLineCount,
      newStart: currentChange.newStart,
      newLineCount,
      additions: currentChange.additions,
      deletions: currentChange.deletions,
      kind,
      oldLines: currentChange.oldLines,
      newLines: currentChange.newLines,
      diffLines: currentChange.diffLines,
    });
    markerIndex += 1;
    currentChange = null;
  };

  for (const line of diff.split("\n")) {
    const hunkMatch = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunkMatch) {
      flushChange();
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[3]);
      continue;
    }

    if (line.startsWith("diff --git ") || line.startsWith("+++ ") || line.startsWith("--- ")) {
      flushChange();
      continue;
    }

    if (line.startsWith("+")) {
      const value = line.slice(1);
      const change = startChange();
      change.newLines.push(value);
      change.diffLines.push(line);
      change.additions += 1;
      newLine += 1;
      continue;
    }

    if (line.startsWith("-")) {
      const value = line.slice(1);
      const change = startChange();
      change.oldLines.push(value);
      change.diffLines.push(line);
      change.deletions += 1;
      oldLine += 1;
      continue;
    }

    if (line.startsWith(" ")) {
      flushChange();
      oldLine += 1;
      newLine += 1;
      continue;
    }
  }

  flushChange();
  return markers;
}

function linesMatchAt(
  lines: readonly string[],
  startIndex: number,
  expected: readonly string[],
): boolean {
  if (expected.length === 0) {
    return true;
  }
  if (startIndex + expected.length > lines.length) {
    return false;
  }
  return expected.every((line, index) => lines[startIndex + index] === line);
}
