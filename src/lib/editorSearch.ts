import type { EditorTextMatch } from "./api";
import { parseCssPixels } from "./cssPixels";
import { clamp } from "./numeric";
import type { EditorSearchHighlightSegment } from "./editorTypes";

let editorTextMeasureCanvas: HTMLCanvasElement | null = null;

export function nextMatchIndexAfter(
  matches: readonly EditorTextMatch[],
  offset: number,
): number {
  if (matches.length === 0) {
    return 0;
  }

  const nextIndex = matches.findIndex((match) => match.start >= offset);
  return nextIndex >= 0 ? nextIndex : 0;
}

export function buildEditorSearchHighlightSegments(
  content: string,
  matches: readonly EditorTextMatch[],
  activeIndex: number,
): EditorSearchHighlightSegment[] {
  if (!content || matches.length === 0) {
    return [];
  }

  const activeMatch = matches[clamp(activeIndex, 0, matches.length - 1)];
  if (!activeMatch) {
    return [];
  }

  const segments: EditorSearchHighlightSegment[] = [];
  const start = clamp(activeMatch.start, 0, content.length);
  const end = clamp(activeMatch.end, start, content.length);
  if (end <= start) {
    return [];
  }

  if (start > 0) {
    segments.push({
      kind: "plain",
      text: content.slice(0, start),
    });
  }

  segments.push({
    kind: "match",
    text: content.slice(start, end),
  });

  if (end < content.length) {
    segments.push({
      kind: "plain",
      text: content.slice(end),
    });
  }

  return segments;
}

export function editorMatchHorizontalBounds(
  content: string,
  match: EditorTextMatch,
  textarea: HTMLTextAreaElement,
): { left: number; width: number } | null {
  const start = clamp(match.start, 0, content.length);
  const end = clamp(match.end, start, content.length);
  if (end <= start) {
    return null;
  }

  const lineStart = start > 0 ? content.lastIndexOf("\n", start - 1) + 1 : 0;
  const style = window.getComputedStyle(textarea);
  const paddingLeft = parseCssPixels(style.paddingLeft, 0);
  const prefixWidth = measureEditorInlineTextWidth(
    content.slice(lineStart, start),
    style,
  );
  const matchWidth = Math.max(
    measureEditorInlineTextWidth(content.slice(start, end), style),
    measureEditorInlineTextWidth(" ", style),
  );

  return {
    left: paddingLeft + prefixWidth,
    width: matchWidth,
  };
}

export function getTextareaSelection(
  textarea: HTMLTextAreaElement | null,
): { start: number; end: number } | null {
  if (!textarea) {
    return null;
  }

  return {
    start: textarea.selectionStart,
    end: textarea.selectionEnd,
  };
}

export function measureEditorLineHeight(
  style: CSSStyleDeclaration,
  fallback: number,
): number {
  const lineHeight = parseCssPixels(style.lineHeight, fallback);
  return lineHeight > 0 ? lineHeight : fallback;
}

function measureEditorInlineTextWidth(
  text: string,
  style: CSSStyleDeclaration,
): number {
  const context = getEditorTextMeasureContext();
  const fontSize = parseCssPixels(style.fontSize, 12);
  const measuredText = expandTabsForMeasurement(
    text,
    normalizeEditorTabSize(style.getPropertyValue("tab-size")),
  );
  if (!context) {
    return measuredText.length * fontSize * 0.6;
  }

  context.font =
    style.font ||
    `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return context.measureText(measuredText).width;
}

function getEditorTextMeasureContext(): CanvasRenderingContext2D | null {
  if (!editorTextMeasureCanvas && typeof document !== "undefined") {
    editorTextMeasureCanvas = document.createElement("canvas");
  }

  return editorTextMeasureCanvas?.getContext("2d") ?? null;
}

function normalizeEditorTabSize(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 16 ? parsed : 2;
}

function expandTabsForMeasurement(text: string, tabSize: number): string {
  if (!text.includes("\t")) {
    return text;
  }

  let expanded = "";
  let column = 0;
  for (const character of text) {
    if (character === "\t") {
      const spaces = tabSize - (column % tabSize);
      expanded += " ".repeat(spaces);
      column += spaces;
      continue;
    }

    expanded += character;
    column += 1;
  }

  return expanded;
}
