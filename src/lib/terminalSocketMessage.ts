import type {
  TerminalCursorStyle,
  TerminalBell,
  TerminalClose,
  TerminalFrame,
  TerminalGrapheme,
  TerminalLine,
  TerminalModes,
  TerminalRun,
  TerminalSocketMessage,
} from "./terminalTypes";
import { DEFAULT_TERMINAL_MODES } from "./terminalTypes";

export function parseTerminalSocketMessage(data: string): TerminalSocketMessage | null {
  try {
    const value: unknown = JSON.parse(data);
    if (!isRecord(value) || typeof value.type !== "string") {
      return null;
    }
    switch (value.type) {
      case "bell":
        return { type: "bell" } satisfies TerminalBell;
      case "close":
        return parseClose(value);
      case "frame":
        return parseFrame(value);
      default:
        return null;
    }
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    return null;
  }
}

export function createTerminalErrorFrame(error: unknown): TerminalFrame {
  return {
    type: "frame",
    title: null,
    cwd: null,
    rows: 1,
    cols: 80,
    displayOffset: 0,
    lineOffset: 0,
    historySize: 0,
    cursorRow: 0,
    cursorCol: 0,
    cursorVisible: false,
    cursorShape: "block",
    modes: DEFAULT_TERMINAL_MODES,
    lines: [
      {
        cells: [
          {
            text: error instanceof Error ? error.message : String(error),
            bold: false,
            dim: false,
            italic: false,
            underline: false,
            inverse: false,
          },
        ],
      },
    ],
  };
}

function parseClose(value: Readonly<Record<string, unknown>>): TerminalClose | null {
  if (value.exitCode != null && typeof value.exitCode !== "number") {
    return null;
  }
  return {
    type: "close",
    exitCode: value.exitCode ?? null,
  };
}

function parseFrame(value: Readonly<Record<string, unknown>>): TerminalFrame | null {
  if (
    typeof value.rows !== "number" ||
    typeof value.cols !== "number" ||
    typeof value.displayOffset !== "number" ||
    typeof value.cursorRow !== "number" ||
    typeof value.cursorCol !== "number" ||
    typeof value.cursorVisible !== "boolean" ||
    !isTerminalCursorStyle(value.cursorShape) ||
    !Array.isArray(value.lines)
  ) {
    return null;
  }
  const lines = parseLines(value.lines);
  if (!lines) {
    return null;
  }
  return {
    type: "frame",
    title: typeof value.title === "string" ? value.title : null,
    cwd: typeof value.cwd === "string" ? value.cwd : null,
    rows: value.rows,
    cols: value.cols,
    displayOffset: value.displayOffset,
    lineOffset:
      typeof value.lineOffset === "number" ? value.lineOffset : -value.displayOffset,
    historySize:
      typeof value.historySize === "number" ? value.historySize : value.displayOffset,
    cursorRow: value.cursorRow,
    cursorCol: value.cursorCol,
    cursorVisible: value.cursorVisible,
    cursorShape: value.cursorShape,
    modes: parseModes(value.modes),
    lines,
  };
}

function parseModes(value: unknown): TerminalModes {
  if (!isRecord(value)) {
    return DEFAULT_TERMINAL_MODES;
  }
  return {
    appCursor: value.appCursor === true,
    appKeypad: value.appKeypad === true,
    bracketedPaste: value.bracketedPaste === true,
    focusInOut: value.focusInOut === true,
    mouseReportClick: value.mouseReportClick === true,
    mouseDrag: value.mouseDrag === true,
    mouseMotion: value.mouseMotion === true,
    sgrMouse: value.sgrMouse === true,
    utf8Mouse: value.utf8Mouse === true,
    altScreen: value.altScreen === true,
  };
}

function parseLines(values: readonly unknown[]): readonly TerminalLine[] | null {
  const lines: TerminalLine[] = [];
  for (const value of values) {
    if (!isRecord(value) || !Array.isArray(value.cells)) {
      return null;
    }
    const cells = parseRuns(value.cells);
    if (!cells) {
      return null;
    }
    lines.push({ cells });
  }
  return lines;
}

function parseRuns(values: readonly unknown[]): readonly TerminalRun[] | null {
  const runs: TerminalRun[] = [];
  for (const value of values) {
    if (!isRecord(value) || typeof value.text !== "string") {
      return null;
    }
    runs.push({
      text: value.text,
      columns: typeof value.columns === "number" ? value.columns : undefined,
      simpleAscii: typeof value.simpleAscii === "boolean" ? value.simpleAscii : undefined,
      graphemes: Array.isArray(value.graphemes)
        ? parseGraphemes(value.graphemes)
        : undefined,
      fg: typeof value.fg === "string" ? value.fg : null,
      bg: typeof value.bg === "string" ? value.bg : null,
      href: typeof value.href === "string" ? value.href : null,
      bold: value.bold === true,
      dim: value.dim === true,
      italic: value.italic === true,
      underline: value.underline === true,
      inverse: value.inverse === true,
    });
  }
  return runs;
}

function parseGraphemes(values: readonly unknown[]): readonly TerminalGrapheme[] | undefined {
  const graphemes: TerminalGrapheme[] = [];
  for (const value of values) {
    if (
      !isRecord(value) ||
      typeof value.text !== "string" ||
      typeof value.columns !== "number"
    ) {
      return undefined;
    }
    graphemes.push({
      text: value.text,
      columns: Math.max(1, Math.trunc(value.columns)),
    });
  }
  return graphemes.length > 0 ? graphemes : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function isTerminalCursorStyle(value: unknown): value is TerminalCursorStyle {
  switch (value) {
    case "bar":
    case "block":
    case "hollowBlock":
    case "underline":
      return true;
    default:
      return false;
  }
}
