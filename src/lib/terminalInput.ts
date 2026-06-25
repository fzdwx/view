import {
  MIN_TERMINAL_COLS,
  MIN_TERMINAL_ROWS,
  type TerminalCellMetrics,
  type TerminalInput,
  type TerminalModes,
} from "./terminalTypes";
import { sizeFromElement } from "./terminalViewport";

const TEXT_ENCODER = new TextEncoder();

export function keyToTerminalInput(
  event: KeyboardEvent,
  modes: TerminalModes,
): string | null {
  if (event.defaultPrevented || event.isComposing || isModifierKey(event)) {
    return null;
  }

  if (event.ctrlKey && !event.altKey && !event.metaKey) {
    const key = event.key.toLowerCase();
    if (key === "v") {
      return null;
    }
    if (key.length === 1 && key >= "a" && key <= "z") {
      return String.fromCharCode(key.charCodeAt(0) - 96);
    }
    return key === "[" ? "\x1b" : null;
  }

  switch (event.key) {
    case "Enter":
      return "\r";
    case "Backspace":
      return "\x7f";
    case "Tab":
      return event.shiftKey ? "\x1b[Z" : "\t";
    case "Escape":
      return "\x1b";
    case "ArrowUp":
      return modes.appCursor ? "\x1bOA" : "\x1b[A";
    case "ArrowDown":
      return modes.appCursor ? "\x1bOB" : "\x1b[B";
    case "ArrowRight":
      return modes.appCursor ? "\x1bOC" : "\x1b[C";
    case "ArrowLeft":
      return modes.appCursor ? "\x1bOD" : "\x1b[D";
    case "Home":
      return "\x1b[H";
    case "End":
      return "\x1b[F";
    case "Insert":
      return "\x1b[2~";
    case "Delete":
      return "\x1b[3~";
    case "PageUp":
      return "\x1b[5~";
    case "PageDown":
      return "\x1b[6~";
    case "F1":
      return "\x1bOP";
    case "F2":
      return "\x1bOQ";
    case "F3":
      return "\x1bOR";
    case "F4":
      return "\x1bOS";
    case "F5":
      return "\x1b[15~";
    case "F6":
      return "\x1b[17~";
    case "F7":
      return "\x1b[18~";
    case "F8":
      return "\x1b[19~";
    case "F9":
      return "\x1b[20~";
    case "F10":
      return "\x1b[21~";
    case "F11":
      return "\x1b[23~";
    case "F12":
      return "\x1b[24~";
    default:
      return printableKeyToInput(event);
  }
}

export function terminalMouseEnabled(modes: TerminalModes): boolean {
  return modes.mouseReportClick || modes.mouseDrag || modes.mouseMotion;
}

export function mouseButtonCode(button: number): number | null {
  switch (button) {
    case 0:
      return 0;
    case 1:
      return 1;
    case 2:
      return 2;
    default:
      return null;
  }
}

export function mouseModifierCode(event: MouseEvent | WheelEvent): number {
  return (
    (event.shiftKey ? 4 : 0) +
    (event.altKey ? 8 : 0) +
    (event.ctrlKey ? 16 : 0)
  );
}

export function terminalMousePosition(
  event: MouseEvent | WheelEvent,
  element: HTMLElement,
  cellMetrics: TerminalCellMetrics,
): { readonly col: number; readonly row: number } {
  const rect = element.getBoundingClientRect();
  const col = Math.floor((event.clientX - rect.left) / cellMetrics.width) + 1;
  const row = Math.floor((event.clientY - rect.top) / cellMetrics.height) + 1;
  const size = sizeFromElement(element, cellMetrics);
  const cols = size?.cols ?? MIN_TERMINAL_COLS;
  const rows = size?.rows ?? MIN_TERMINAL_ROWS;

  return {
    col: Math.min(cols, Math.max(1, col)),
    row: Math.min(rows, Math.max(1, row)),
  };
}

export function normalizeWheelLines(
  event: WheelEvent,
  cellMetrics: TerminalCellMetrics,
  visibleRows: number,
): number {
  switch (event.deltaMode) {
    case WheelEvent.DOM_DELTA_LINE:
      return event.deltaY;
    case WheelEvent.DOM_DELTA_PAGE:
      return event.deltaY * Math.max(1, visibleRows);
    default:
      return event.deltaY / Math.max(1, cellMetrics.height);
  }
}

export function selectedTextWithin(element: HTMLElement): string {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return "";
  }

  const range = selection.getRangeAt(0);
  if (!element.contains(range.commonAncestorContainer)) {
    return "";
  }

  return terminalSelectedTextWithin(element, range) ?? selection.toString();
}

export function normalizeTerminalSelectedLineText(text: string): string {
  return text.replace(/\r\n|\r|\n/g, "");
}

function terminalSelectedTextWithin(
  element: HTMLElement,
  range: Range,
): string | null {
  const lines = Array.from(
    element.querySelectorAll<HTMLElement>(".terminal-line"),
  ).filter((line) => rangeIntersectsNode(range, line));
  if (lines.length === 0) {
    return null;
  }

  return lines
    .map((line) => normalizeTerminalSelectedLineText(textForSelectedLine(line, range)))
    .join("\n");
}

function textForSelectedLine(line: HTMLElement, selectionRange: Range): string {
  const lineRange = document.createRange();
  lineRange.selectNodeContents(line);
  if (line.contains(selectionRange.startContainer)) {
    lineRange.setStart(selectionRange.startContainer, selectionRange.startOffset);
  }
  if (line.contains(selectionRange.endContainer)) {
    lineRange.setEnd(selectionRange.endContainer, selectionRange.endOffset);
  }

  const text = lineRange.toString();
  lineRange.detach();
  return text;
}

function rangeIntersectsNode(range: Range, node: Node): boolean {
  try {
    return range.intersectsNode(node);
  } catch {
    return false;
  }
}

export function terminalInputByteLength(input: TerminalInput): number {
  return typeof input === "string"
    ? TEXT_ENCODER.encode(input).byteLength
    : input.byteLength;
}

export function terminalMouseSequence(
  modes: TerminalModes,
  code: number,
  col: number,
  row: number,
  pressed: boolean,
): TerminalInput | null {
  if (modes.sgrMouse) {
    return `\x1b[<${code};${col};${row}${pressed ? "M" : "m"}`;
  }

  const normalCode = pressed ? code : 3 + (code & 28);
  if (modes.utf8Mouse) {
    return `\x1b[M${String.fromCodePoint(normalCode + 32)}${String.fromCodePoint(
      col + 32,
    )}${String.fromCodePoint(row + 32)}`;
  }

  const encodedCode = normalMouseByte(normalCode);
  const encodedCol = normalMouseByte(col);
  const encodedRow = normalMouseByte(row);
  if (encodedCode == null || encodedCol == null || encodedRow == null) {
    return null;
  }

  return new Uint8Array([
    0x1b,
    0x5b,
    0x4d,
    encodedCode,
    encodedCol,
    encodedRow,
  ]);
}

export function isTerminalHyperlinkEventTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(".terminal-hyperlink") != null;
}

function isModifierKey(event: KeyboardEvent): boolean {
  return (
    event.key === "Control" ||
    event.key === "Shift" ||
    event.key === "Alt" ||
    event.key === "Meta" ||
    event.code === "ControlLeft" ||
    event.code === "ControlRight" ||
    event.code === "ShiftLeft" ||
    event.code === "ShiftRight" ||
    event.code === "AltLeft" ||
    event.code === "AltRight" ||
    event.code === "MetaLeft" ||
    event.code === "MetaRight"
  );
}

function printableKeyToInput(event: KeyboardEvent): string | null {
  if (
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    event.key.length === 1
  ) {
    return event.key;
  }
  if (event.altKey && !event.metaKey && event.key.length === 1) {
    return `\x1b${event.key}`;
  }
  return null;
}

function normalMouseByte(value: number): number | null {
  const byte = value + 32;
  return byte >= 32 && byte <= 255 ? byte : null;
}
