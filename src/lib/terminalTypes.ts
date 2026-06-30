import type { TerminalCursorStyle } from "./api";

export type { TerminalCursorStyle };

export interface TerminalGrapheme {
  readonly text: string;
  readonly columns: number;
}

export interface TerminalRun {
  readonly text: string;
  readonly columns?: number;
  readonly simpleAscii?: boolean;
  readonly graphemes?: readonly TerminalGrapheme[];
  readonly fg?: string | null;
  readonly bg?: string | null;
  readonly href?: string | null;
  readonly bold: boolean;
  readonly dim: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly inverse: boolean;
}

export interface TerminalLine {
  readonly cells: readonly TerminalRun[];
}

export interface TerminalModes {
  readonly appCursor: boolean;
  readonly appKeypad: boolean;
  readonly bracketedPaste: boolean;
  readonly focusInOut: boolean;
  readonly mouseReportClick: boolean;
  readonly mouseDrag: boolean;
  readonly mouseMotion: boolean;
  readonly sgrMouse: boolean;
  readonly utf8Mouse: boolean;
  readonly altScreen: boolean;
}

export type TerminalCommandPhase = "finished" | "input" | "prompt" | "running";

export interface TerminalCommandStatus {
  readonly phase: TerminalCommandPhase;
  readonly exitCode: number | null;
}

export interface TerminalCellMetrics {
  readonly width: number;
  readonly height: number;
}

export interface TerminalFrame {
  readonly type: "frame";
  readonly title: string | null;
  readonly cwd: string | null;
  readonly oscCwd: string | null;
  readonly commandStatus: TerminalCommandStatus | null;
  readonly rows: number;
  readonly cols: number;
  readonly displayOffset: number;
  readonly lineOffset: number;
  readonly historySize: number;
  readonly cursorRow: number;
  readonly cursorCol: number;
  readonly cursorVisible: boolean;
  readonly cursorShape: TerminalCursorStyle;
  readonly modes: TerminalModes;
  readonly lines: readonly TerminalLine[];
}

export interface TerminalClose {
  readonly type: "close";
  readonly exitCode: number | null;
}

export interface TerminalBell {
  readonly type: "bell";
}

export type TerminalSocketMessage = TerminalFrame | TerminalClose | TerminalBell;
export type TerminalInput = string | Uint8Array;

export const MIN_TERMINAL_COLS = 20;
export const MIN_TERMINAL_ROWS = 6;
export const DEFAULT_TERMINAL_CELL_METRICS: TerminalCellMetrics = {
  width: 8,
  height: 16,
};
export const MAX_TERMINAL_COLS = 260;
export const MAX_TERMINAL_ROWS = 120;
export const MAX_PENDING_INPUT_BYTES = 32 * 1024;
export const MAX_SOCKET_BUFFERED_INPUT_BYTES = 256 * 1024;
export const TERMINAL_SCROLLBACK_HINT_TTL_MS = 4000;
export const DEFAULT_TERMINAL_MODES: TerminalModes = {
  appCursor: false,
  appKeypad: false,
  bracketedPaste: false,
  focusInOut: false,
  mouseReportClick: false,
  mouseDrag: false,
  mouseMotion: false,
  sgrMouse: false,
  utf8Mouse: false,
  altScreen: false,
};
