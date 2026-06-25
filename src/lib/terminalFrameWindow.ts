import type { TerminalFrame, TerminalLine } from "./terminalTypes";

const emptyTerminalLine: TerminalLine = Object.freeze({
  cells: Object.freeze([]),
});

export function terminalFrameLineOffset(frame: TerminalFrame): number {
  return Number.isFinite(frame.lineOffset)
    ? Math.trunc(frame.lineOffset)
    : -Math.max(0, Math.trunc(frame.displayOffset));
}

export function terminalFrameHistorySize(frame: TerminalFrame): number {
  return Number.isFinite(frame.historySize)
    ? Math.max(0, Math.trunc(frame.historySize))
    : Math.max(0, Math.trunc(frame.displayOffset));
}

export function terminalVisibleLogicalRow(
  frame: TerminalFrame,
  viewportRow: number,
): number {
  return viewportRow - Math.max(0, Math.trunc(frame.displayOffset));
}

export function terminalVisibleLineAt(
  frame: TerminalFrame,
  viewportRow: number,
): TerminalLine {
  const lineIndex =
    terminalVisibleLogicalRow(frame, viewportRow) - terminalFrameLineOffset(frame);
  return frame.lines[lineIndex] ?? emptyTerminalLine;
}

export function terminalFrameHasVisibleWindow(
  frame: TerminalFrame,
  displayOffset: number,
): boolean {
  const safeDisplayOffset = Math.max(0, Math.trunc(displayOffset));
  const firstLogicalRow = -safeDisplayOffset;
  const lastLogicalRow = frame.rows - safeDisplayOffset - 1;
  const lineOffset = terminalFrameLineOffset(frame);
  const lineEnd = lineOffset + frame.lines.length - 1;

  return firstLogicalRow >= lineOffset && lastLogicalRow <= lineEnd;
}

export function previewTerminalScrollFrame(
  frame: TerminalFrame,
  delta: number,
): TerminalFrame | null {
  if (!Number.isFinite(delta) || delta === 0 || frame.modes.altScreen) {
    return null;
  }

  const historySize = terminalFrameHistorySize(frame);
  const nextDisplayOffset = clamp(
    Math.trunc(frame.displayOffset + delta),
    0,
    historySize,
  );
  if (
    nextDisplayOffset === frame.displayOffset ||
    !terminalFrameHasVisibleWindow(frame, nextDisplayOffset)
  ) {
    return null;
  }

  const cursorLogicalRow = frame.cursorRow - frame.displayOffset;
  const nextCursorRow = cursorLogicalRow + nextDisplayOffset;
  const cursorVisible =
    frame.cursorVisible && nextCursorRow >= 0 && nextCursorRow < frame.rows;

  return {
    ...frame,
    displayOffset: nextDisplayOffset,
    cursorRow: Math.max(0, nextCursorRow),
    cursorVisible,
  };
}

export function alignTerminalFrameDisplayOffset(
  frame: TerminalFrame,
  displayOffset: number,
): TerminalFrame | null {
  const nextDisplayOffset = clamp(
    Math.trunc(displayOffset),
    0,
    terminalFrameHistorySize(frame),
  );
  if (nextDisplayOffset === frame.displayOffset) {
    return frame;
  }

  return previewTerminalScrollFrame(
    frame,
    nextDisplayOffset - frame.displayOffset,
  );
}

export interface TerminalScrollKeyInput {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

export function terminalScrollDeltaForKey(
  frame: TerminalFrame | null,
  event: TerminalScrollKeyInput,
): number | null {
  if (
    !frame ||
    frame.modes.altScreen ||
    !event.shiftKey ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  ) {
    return null;
  }

  const displayOffset = Math.max(0, Math.trunc(frame.displayOffset));
  const historySize = terminalFrameHistorySize(frame);
  const pageRows = Math.max(1, Math.trunc(frame.rows) - 1);

  switch (event.key) {
    case "PageUp":
      return clamp(historySize - displayOffset, 0, pageRows);
    case "PageDown":
      return -clamp(displayOffset, 0, pageRows);
    case "Home":
      return historySize - displayOffset;
    case "End":
      return -displayOffset;
    default:
      return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
