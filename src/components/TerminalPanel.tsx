import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import { Plus, TerminalSquare, X } from "lucide-react";
import {
  isTauriRuntime,
  openExternalUrl,
  terminalKill,
  terminalResize,
  terminalScroll,
  terminalSpawn,
} from "../lib/api";
import {
  addTerminalTab,
  closeTerminalTab,
  createInitialTerminalWorkspace,
  getTerminalWorkspace,
  selectTerminalTab,
  setTerminalTabClosed,
  setTerminalTabSession,
  setTerminalTabTitle,
  subscribeTerminalWorkspaces,
  type TerminalSessionInfo,
  type TerminalWorkspace,
} from "../lib/terminalSessions";
import { type AppSettings, loadAppSettings, settingsChangedEvent } from "../lib/settings";
import type { TerminalCursorStyle, TerminalSpawnOptions } from "../lib/api";
import {
  terminalBlockRects,
  terminalBoxSegments,
  type TerminalBlockRect,
  type TerminalBoxSegments,
} from "../lib/terminalGlyphs";
import { terminalRunStyle } from "../lib/terminalRunStyle";

interface TerminalPanelProps {
  active: boolean;
  projectPath: string | null;
}

type TerminalRun = {
  text: string;
  fg?: string | null;
  bg?: string | null;
  href?: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
};

type TerminalLine = {
  cells: TerminalRun[];
};

type TerminalModes = {
  appCursor: boolean;
  appKeypad: boolean;
  bracketedPaste: boolean;
  focusInOut: boolean;
  mouseReportClick: boolean;
  mouseDrag: boolean;
  mouseMotion: boolean;
  sgrMouse: boolean;
  utf8Mouse: boolean;
  altScreen: boolean;
};

type TerminalCellMetrics = {
  width: number;
  height: number;
};

type TerminalFrame = {
  type: "frame";
  title: string | null;
  rows: number;
  cols: number;
  displayOffset: number;
  cursorRow: number;
  cursorCol: number;
  cursorVisible: boolean;
  cursorShape: TerminalCursorStyle;
  modes: TerminalModes;
  lines: TerminalLine[];
};

type TerminalClose = {
  type: "close";
  exitCode: number | null;
};

type TerminalBell = {
  type: "bell";
};

type TerminalInput = string | Uint8Array;

const MIN_TERMINAL_COLS = 20;
const MIN_TERMINAL_ROWS = 6;
const DEFAULT_TERMINAL_CELL_METRICS: TerminalCellMetrics = {
  width: 8,
  height: 16,
};
const MAX_TERMINAL_COLS = 260;
const MAX_TERMINAL_ROWS = 120;
const MAX_PENDING_INPUT_BYTES = 32 * 1024;
const MAX_SOCKET_BUFFERED_INPUT_BYTES = 256 * 1024;
const TERMINAL_SCROLLBACK_HINT_TTL_MS = 4000;
const TEXT_ENCODER = new TextEncoder();
const terminalGraphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;
const EMOJI_GRAPHEME_PATTERN =
  /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{20E3}\u{FE0F}]/u;
const TERMINAL_WIDE_GRAPHEME_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u{1100}-\u{115F}\u{2329}\u{232A}\u{2E80}-\u{303F}\u{3040}-\u{A4CF}\u{AC00}-\u{D7A3}\u{F900}-\u{FAFF}\u{FE10}-\u{FE19}\u{FE30}-\u{FE6F}\u{FF01}-\u{FF60}\u{FFE0}-\u{FFE6}]/u;
const DEFAULT_TERMINAL_MODES: TerminalModes = {
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

function parsePixelSize(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function snapTerminalMetricToDevicePixel(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  const devicePixelRatio =
    Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
      ? window.devicePixelRatio
      : 1;
  return Math.max(1 / devicePixelRatio, Math.round(value * devicePixelRatio) / devicePixelRatio);
}

function measureTerminalCellMetrics(element: HTMLElement): TerminalCellMetrics {
  const computed = window.getComputedStyle(element);
  const probe = document.createElement("span");
  const sample = "0".repeat(64);

  probe.textContent = sample;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.whiteSpace = "pre";
  probe.style.padding = "0";
  probe.style.margin = "0";
  probe.style.border = "0";
  probe.style.fontFamily = computed.fontFamily;
  probe.style.fontSize = computed.fontSize;
  probe.style.fontWeight = computed.fontWeight;
  probe.style.fontStyle = computed.fontStyle;
  probe.style.lineHeight = computed.lineHeight;
  probe.style.letterSpacing = computed.letterSpacing;
  probe.style.fontVariantLigatures = "none";
  probe.style.fontKerning = "none";

  element.appendChild(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();

  const measuredWidth = snapTerminalMetricToDevicePixel(rect.width / sample.length);
  const measuredHeight = snapTerminalMetricToDevicePixel(
    parsePixelSize(computed.lineHeight) ??
      (Number.isFinite(rect.height) && rect.height > 0 ? rect.height : null),
  );

  return {
    width: measuredWidth ?? DEFAULT_TERMINAL_CELL_METRICS.width,
    height: measuredHeight ?? DEFAULT_TERMINAL_CELL_METRICS.height,
  };
}

function sizeFromElement(
  element: HTMLElement,
  cellMetrics: TerminalCellMetrics,
): { cols: number; rows: number } | null {
  const rect = element.getBoundingClientRect();
  const width = Number.isFinite(rect.width) ? rect.width : 0;
  const height = Number.isFinite(rect.height) ? rect.height : 0;
  const safeCellWidth = Math.max(1, cellMetrics.width);
  const safeCellHeight = Math.max(1, cellMetrics.height);

  if (width < safeCellWidth || height < safeCellHeight) {
    return null;
  }

  return {
    cols: Math.min(
      MAX_TERMINAL_COLS,
      Math.max(MIN_TERMINAL_COLS, Math.floor(width / safeCellWidth)),
    ),
    rows: Math.min(
      MAX_TERMINAL_ROWS,
      Math.max(MIN_TERMINAL_ROWS, Math.floor(height / safeCellHeight)),
    ),
  };
}

function keyToTerminalInput(
  event: KeyboardEvent,
  modes: TerminalModes,
): string | null {
  if (event.defaultPrevented || event.isComposing) {
    return null;
  }

  if (
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
  ) {
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
    if (key === "[") {
      return "\x1b";
    }
    return null;
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
}

function terminalMouseEnabled(modes: TerminalModes): boolean {
  return modes.mouseReportClick || modes.mouseDrag || modes.mouseMotion;
}

function mouseButtonCode(button: number): number | null {
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

function mouseModifierCode(event: MouseEvent | WheelEvent): number {
  return (
    (event.shiftKey ? 4 : 0) +
    (event.altKey ? 8 : 0) +
    (event.ctrlKey ? 16 : 0)
  );
}

function terminalMousePosition(
  event: MouseEvent | WheelEvent,
  element: HTMLElement,
  cellMetrics: TerminalCellMetrics,
): { col: number; row: number } {
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

function normalizeWheelLines(
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

function selectedTextWithin(element: HTMLElement): string {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return "";
  }

  const range = selection.getRangeAt(0);
  if (!element.contains(range.commonAncestorContainer)) {
    return "";
  }

  return selection.toString();
}

function terminalInputByteLength(input: TerminalInput): number {
  return typeof input === "string"
    ? TEXT_ENCODER.encode(input).byteLength
    : input.byteLength;
}

function normalMouseByte(value: number): number | null {
  const byte = value + 32;
  return byte >= 32 && byte <= 255 ? byte : null;
}

function terminalMouseSequence(
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

function terminalCursorClassName(cursorShape: TerminalCursorStyle): string {
  switch (cursorShape) {
    case "bar":
      return "terminal-cursor terminal-cursor-bar";
    case "underline":
      return "terminal-cursor terminal-cursor-underline";
    case "hollowBlock":
      return "terminal-cursor terminal-cursor-hollow";
    default:
      return "terminal-cursor";
  }
}

async function openTerminalHyperlink(href: string): Promise<void> {
  if (isTauriRuntime()) {
    await openExternalUrl(href);
    return;
  }

  window.open(href, "_blank", "noopener,noreferrer");
}

function reportTerminalHyperlinkError(error: unknown): void {
  if (error instanceof Error) {
    console.warn("Failed to open terminal hyperlink", error);
    return;
  }
  console.warn("Failed to open terminal hyperlink with non-Error rejection", error);
}

function openTerminalHyperlinkFromEvent(href: string): void {
  void openTerminalHyperlink(href).catch(reportTerminalHyperlinkError);
}

function isTerminalHyperlinkEventTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(".terminal-hyperlink") != null;
}

function terminalHyperlinkClickHandler(
  href: string,
  event: ReactMouseEvent<HTMLAnchorElement>,
): void {
  event.preventDefault();
  event.stopPropagation();
  openTerminalHyperlinkFromEvent(href);
}

function terminalHyperlinkKeyDownHandler(
  href: string,
  event: ReactKeyboardEvent<HTMLAnchorElement>,
): void {
  event.stopPropagation();
  if (event.key === " ") {
    event.preventDefault();
    openTerminalHyperlinkFromEvent(href);
  }
}

function renderTerminalRunContainer(
  run: TerminalRun,
  key: string,
  style: CSSProperties,
  columns: number,
  children: ReactNode,
) {
  const href = run.href?.trim();
  const styleWithWidth: CSSProperties = {
    ...style,
    width: `calc(${columns} * var(--terminal-cell-width, ${DEFAULT_TERMINAL_CELL_METRICS.width}px))`,
  };
  if (!href) {
    return (
      <span key={key} className="terminal-run" style={styleWithWidth}>
        {children}
      </span>
    );
  }

  return (
    <a
      key={key}
      className="terminal-run terminal-hyperlink"
      href={href}
      onClick={(event) => terminalHyperlinkClickHandler(href, event)}
      onKeyDown={(event) => terminalHyperlinkKeyDownHandler(href, event)}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
      style={styleWithWidth}
      title={href}
    >
      {children}
    </a>
  );
}

function splitTerminalGraphemes(text: string): string[] {
  const normalizedText = text || " ";
  if (!terminalGraphemeSegmenter) {
    return Array.from(normalizedText);
  }

  const graphemes = Array.from(
    terminalGraphemeSegmenter.segment(normalizedText),
    ({ segment }) => segment,
  );
  return graphemes.length > 0 ? graphemes : [" "];
}

function terminalGraphemeColumns(grapheme: string): number {
  return EMOJI_GRAPHEME_PATTERN.test(grapheme) ||
    TERMINAL_WIDE_GRAPHEME_PATTERN.test(grapheme)
    ? 2
    : 1;
}

function terminalTextColumns(graphemes: readonly string[]): number {
  return graphemes.reduce(
    (totalColumns, grapheme) => totalColumns + terminalGraphemeColumns(grapheme),
    0,
  );
}

function terminalCellStyle(columns: number): CSSProperties | undefined {
  return columns === 1
    ? undefined
    : {
        width: `calc(${columns} * var(--terminal-cell-width, ${DEFAULT_TERMINAL_CELL_METRICS.width}px))`,
      };
}

function terminalCursorGraphemeIndex(
  graphemes: readonly string[],
  columnOffset: number,
): number {
  let consumedColumns = 0;

  for (let index = 0; index < graphemes.length; index += 1) {
    const graphemeColumns = terminalGraphemeColumns(graphemes[index]);
    if (columnOffset < consumedColumns + graphemeColumns) {
      return index;
    }
    consumedColumns += graphemeColumns;
  }

  return Math.max(0, graphemes.length - 1);
}

interface TerminalBoxGlyphProps {
  readonly grapheme: string;
  readonly segments: TerminalBoxSegments;
}

function TerminalBoxGlyph({ grapheme, segments }: TerminalBoxGlyphProps) {
  return (
    <span className="terminal-box-glyph">
      <span className="terminal-glyph-text">{grapheme}</span>
      {segments.top ? (
        <span className="terminal-box-segment terminal-box-segment-top" />
      ) : null}
      {segments.right ? (
        <span className="terminal-box-segment terminal-box-segment-right" />
      ) : null}
      {segments.bottom ? (
        <span className="terminal-box-segment terminal-box-segment-bottom" />
      ) : null}
      {segments.left ? (
        <span className="terminal-box-segment terminal-box-segment-left" />
      ) : null}
    </span>
  );
}

interface TerminalBlockGlyphProps {
  readonly grapheme: string;
  readonly rects: readonly TerminalBlockRect[];
}

function TerminalBlockGlyph({ grapheme, rects }: TerminalBlockGlyphProps) {
  return (
    <span className="terminal-block-glyph">
      <span className="terminal-glyph-text">{grapheme}</span>
      {rects.map((rect, index) => (
        <span
          key={`${rect.top}-${rect.right}-${rect.bottom}-${rect.left}-${index}`}
          className="terminal-block-rect"
          style={{
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            left: rect.left,
          }}
        />
      ))}
    </span>
  );
}

interface TerminalCellsProps {
  readonly graphemes: readonly string[];
  readonly keyPrefix: string;
  readonly cursorIndex: number | null;
  readonly cursorShape: TerminalCursorStyle;
}

function TerminalCells({
  graphemes,
  keyPrefix,
  cursorIndex,
  cursorShape,
}: TerminalCellsProps) {
  let column = 0;

  return graphemes.map((grapheme) => {
    const columns = terminalGraphemeColumns(grapheme);
    const key = `${keyPrefix}-${column}`;
    const boxSegments = terminalBoxSegments(grapheme);
    const blockRects = terminalBlockRects(grapheme);
    const classNames = ["terminal-cell"];
    if (EMOJI_GRAPHEME_PATTERN.test(grapheme)) {
      classNames.push("terminal-emoji-run");
    }
    if (boxSegments || blockRects) {
      classNames.push("terminal-box-cell");
    }
    if (cursorIndex != null && terminalCursorGraphemeIndex(graphemes, column) === cursorIndex) {
      classNames.push(...terminalCursorClassName(cursorShape).split(" "));
    }
    column += columns;

    return (
      <span key={key} className={classNames.join(" ")} style={terminalCellStyle(columns)}>
        {blockRects ? (
          <TerminalBlockGlyph grapheme={grapheme} rects={blockRects} />
        ) : boxSegments ? (
          <TerminalBoxGlyph grapheme={grapheme} segments={boxSegments} />
        ) : (
          grapheme
        )}
      </span>
    );
  });
}

function renderRunWithCursor(
  run: TerminalRun,
  row: number,
  startCol: number,
  frame: TerminalFrame,
  graphemes: readonly string[],
) {
  const textColumns = terminalTextColumns(graphemes);
  const cursorInRun =
    frame.cursorVisible &&
    frame.cursorRow === row &&
    frame.cursorCol >= startCol &&
    frame.cursorCol < startCol + textColumns;
  const style = terminalRunStyle(run);
  const key = `${startCol}-${graphemes.length}`;

  if (!cursorInRun) {
    return renderTerminalRunContainer(
      run,
      key,
      style,
      textColumns,
      <TerminalCells
        graphemes={graphemes}
        keyPrefix={`${startCol}`}
        cursorIndex={null}
        cursorShape={frame.cursorShape}
      />,
    );
  }

  const cursorIndex = terminalCursorGraphemeIndex(graphemes, frame.cursorCol - startCol);

  return renderTerminalRunContainer(
    run,
    key,
    style,
    textColumns,
    <TerminalCells
      graphemes={graphemes}
      keyPrefix={`${startCol}`}
      cursorIndex={cursorIndex}
      cursorShape={frame.cursorShape}
    />,
  );
}

interface TrailingCursorProps {
  readonly row: number;
  readonly frame: TerminalFrame;
  readonly renderedColumns: number;
}

function TrailingCursor({ row, frame, renderedColumns }: TrailingCursorProps) {
  if (!frame.cursorVisible || frame.cursorRow !== row || frame.cursorCol < renderedColumns) {
    return null;
  }

  const missingColumns = Math.max(1, frame.cursorCol - renderedColumns + 1);
  const paddingCells = Array.from({ length: missingColumns }, () => " ");
  const style: CSSProperties = {
    width: `calc(${missingColumns} * var(--terminal-cell-width, ${DEFAULT_TERMINAL_CELL_METRICS.width}px))`,
  };

  return (
    <span key="trailing-cursor" className="terminal-run" style={style}>
      <TerminalCells
        graphemes={paddingCells}
        keyPrefix={`${row}-trailing-cursor`}
        cursorIndex={missingColumns - 1}
        cursorShape={frame.cursorShape}
      />
    </span>
  );
}

function TerminalRows({ frame }: { frame: TerminalFrame }) {
  return (
    <>
      {frame.lines.map((line, row) => {
        let column = 0;
        return (
          <div key={row} className="terminal-line">
            {line.cells.map((run) => {
              const graphemes = splitTerminalGraphemes(run.text || " ");
              const startColumn = column;
              column += terminalTextColumns(graphemes);
              return renderRunWithCursor(
                run,
                row,
                startColumn,
                frame,
                graphemes,
              );
            })}
            <TrailingCursor row={row} frame={frame} renderedColumns={column} />
          </div>
        );
      })}
    </>
  );
}

function toTerminalSpawnOptions(
  settings: AppSettings["terminal"],
): TerminalSpawnOptions {
  return {
    shell: settings.shell,
    scrollbackLines: settings.scrollbackLines,
    cursorStyle: settings.cursorStyle,
    visualBell: settings.visualBell,
  };
}

interface TerminalSessionViewProps {
  active: boolean;
  projectPath: string;
  /** Existing live PTY session to reconnect to, or null to spawn a new one. */
  session: TerminalSessionInfo | null;
  terminalOptions: TerminalSpawnOptions;
  /** Command to send to the PTY once the WebSocket is open. */
  pendingCommand: string | null;
  onTitleChange(title: string | null): void;
  onSessionReady(session: TerminalSessionInfo): void;
  onClosed(exitCode: number | null): void;
}

// TerminalSessionView couples the PTY lifecycle to its UI; splitting it is a
// separate, behavior-sensitive refactor tracked outside this cleanup.
// oxlint-disable-next-line react-doctor/no-giant-component
function TerminalSessionView({
  active,
  projectPath,
  session,
  terminalOptions,
  pendingCommand,
  onTitleChange,
  onSessionReady,
  onClosed,
}: TerminalSessionViewProps) {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pendingCommandSentRef = useRef(false);
  const pendingInputRef = useRef<TerminalInput[]>([]);
  const pendingInputBytesRef = useRef(0);
  const inputFlushTimerRef = useRef<number | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const activeRef = useRef(active);
  const titleChangeRef = useRef(onTitleChange);
  const onSessionReadyRef = useRef(onSessionReady);
  const onClosedRef = useRef(onClosed);
  const sessionRef = useRef<TerminalSessionInfo | null>(session);
  const frameRef = useRef<TerminalFrame | null>(null);
  const cellMetricsRef = useRef<TerminalCellMetrics>(
    DEFAULT_TERMINAL_CELL_METRICS,
  );
  const wheelScrollAccumulatorRef = useRef(0);
  const pendingScrollIntentRef = useRef<{
    direction: "up" | "down" | "bottom";
    expiresAt: number;
  } | null>(null);
  const scrollbackHintTimerRef = useRef<number | null>(null);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const pendingFrameRef = useRef<TerminalFrame | null>(null);
  const frameFlushRef = useRef<number | null>(null);
  const modesRef = useRef<TerminalModes>(DEFAULT_TERMINAL_MODES);
  const mouseButtonRef = useRef<number | null>(null);
  const [frame, setFrame] = useState<TerminalFrame | null>(null);
  const [closed, setClosed] = useState<TerminalClose | null>(null);
  const [jumpedScrollbackOffset, setJumpedScrollbackOffset] = useState<
    number | null
  >(null);
  const visualBellTimerRef = useRef<number | null>(null);
  const [bellActive, setBellActive] = useState(false);

  const triggerVisualBell = () => {
    if (visualBellTimerRef.current != null) {
      window.clearTimeout(visualBellTimerRef.current);
    }
    setBellActive(true);
    visualBellTimerRef.current = window.setTimeout(() => {
      visualBellTimerRef.current = null;
      setBellActive(false);
    }, 180);
  };

  const clearScrollbackHint = () => {
    if (scrollbackHintTimerRef.current != null) {
      window.clearTimeout(scrollbackHintTimerRef.current);
      scrollbackHintTimerRef.current = null;
    }
    setJumpedScrollbackOffset(null);
  };

  const showScrollbackHint = (offset: number) => {
    if (offset <= 0) {
      clearScrollbackHint();
      return;
    }
    if (scrollbackHintTimerRef.current != null) {
      window.clearTimeout(scrollbackHintTimerRef.current);
    }
    setJumpedScrollbackOffset(offset);
    scrollbackHintTimerRef.current = window.setTimeout(() => {
      scrollbackHintTimerRef.current = null;
      setJumpedScrollbackOffset(null);
    }, TERMINAL_SCROLLBACK_HINT_TTL_MS);
  };

  const markPendingScrollIntent = (direction: "up" | "down" | "bottom") => {
    pendingScrollIntentRef.current = {
      direction,
      expiresAt: performance.now() + 400,
    };
  };

  const consumePendingScrollIntent = (): "up" | "down" | "bottom" | null => {
    const pendingIntent = pendingScrollIntentRef.current;
    if (!pendingIntent) {
      return null;
    }
    pendingScrollIntentRef.current = null;
    return pendingIntent.expiresAt >= performance.now()
      ? pendingIntent.direction
      : null;
  };

  const scrollTerminal = (delta: number, direction: "up" | "down" | "bottom") => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || !Number.isFinite(delta) || delta === 0) {
      return;
    }
    markPendingScrollIntent(direction);
    wheelScrollAccumulatorRef.current = 0;
    if (direction !== "up") {
      clearScrollbackHint();
    }
    void terminalScroll(sessionId, delta).catch(() => undefined);
  };

  const handleScrollToBottom = () => {
    const displayOffset = frameRef.current?.displayOffset ?? 0;
    if (displayOffset > 0) {
      scrollTerminal(-displayOffset, "bottom");
    }
  };

  const handleRestoreScrollback = () => {
    if (jumpedScrollbackOffset == null || jumpedScrollbackOffset <= 0) {
      return;
    }
    scrollTerminal(jumpedScrollbackOffset, "up");
    clearScrollbackHint();
  };

  useEffect(() => {
    activeRef.current = active;
    titleChangeRef.current = onTitleChange;
    onSessionReadyRef.current = onSessionReady;
    onClosedRef.current = onClosed;
  }, [active, onTitleChange, onSessionReady, onClosed]);

  useEffect(() => {
    /* oxlint-disable react-doctor/no-event-handler, react-doctor/no-effect-chain, react-doctor/no-derived-state */
    if (active) {
      screenRef.current?.focus({ preventScroll: true });
    }
    /* oxlint-enable react-doctor/no-event-handler, react-doctor/no-effect-chain, react-doctor/no-derived-state */
  }, [active]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    const screen = screenRef.current;
    if (!screen) {
      return;
    }

    const screenElement = screen;
    let disposed = false;

    const syncCellMetrics = () => {
      const nextMetrics = measureTerminalCellMetrics(screenElement);
      cellMetricsRef.current = nextMetrics;
      screenElement.style.setProperty("--terminal-cell-width", `${nextMetrics.width}px`);
      screenElement.style.setProperty("--terminal-cell-height", `${nextMetrics.height}px`);
      return nextMetrics;
    };

    const queueFrame = (nextFrame: TerminalFrame) => {
      const previousModes = modesRef.current;
      const nextModes = nextFrame.modes ?? DEFAULT_TERMINAL_MODES;
      modesRef.current = nextModes;
      const previousDisplayOffset = frameRef.current?.displayOffset ?? 0;
      const nextDisplayOffset = Math.max(0, nextFrame.displayOffset ?? 0);
      const pendingScrollIntent = consumePendingScrollIntent();
      if (previousDisplayOffset > 0 && nextDisplayOffset === 0) {
        if (pendingScrollIntent === "down" || pendingScrollIntent === "bottom") {
          clearScrollbackHint();
        } else {
          showScrollbackHint(previousDisplayOffset);
        }
      } else if (nextDisplayOffset > 0) {
        clearScrollbackHint();
      }
      if (
        !previousModes.focusInOut &&
        nextModes.focusInOut &&
        activeRef.current &&
        document.activeElement === screenElement
      ) {
        sendInput("\x1b[I");
      }
      pendingFrameRef.current = {
        ...nextFrame,
        displayOffset: nextDisplayOffset,
      };
      if (frameFlushRef.current != null) {
        return;
      }
      frameFlushRef.current = window.requestAnimationFrame(() => {
        frameFlushRef.current = null;
        const pendingFrame = pendingFrameRef.current;
        pendingFrameRef.current = null;
        if (!disposed && pendingFrame) {
          setClosed(null);
          frameRef.current = pendingFrame;
          setFrame(pendingFrame);
        }
      });
    };

    const flushInput = () => {
      inputFlushTimerRef.current = null;
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      if (socket.bufferedAmount > MAX_SOCKET_BUFFERED_INPUT_BYTES) {
        inputFlushTimerRef.current = window.setTimeout(flushInput, 1);
        return;
      }
      const data = pendingInputRef.current.shift();
      if (!data) {
        return;
      }
      pendingInputBytesRef.current = Math.max(
        0,
        pendingInputBytesRef.current - terminalInputByteLength(data),
      );
      try {
        socket.send(data);
        if (pendingInputRef.current.length > 0 && inputFlushTimerRef.current == null) {
          inputFlushTimerRef.current = window.setTimeout(flushInput, 1);
        }
      } catch {
        pendingInputRef.current.unshift(data);
        pendingInputBytesRef.current += terminalInputByteLength(data);
        inputFlushTimerRef.current = window.setTimeout(flushInput, 1);
      }
    };

    const sendInput = (data: TerminalInput | null) => {
      if (!data) {
        return;
      }
      const socket = socketRef.current;
      if (
        socket &&
        socket.readyState === WebSocket.OPEN &&
        socket.bufferedAmount <= MAX_SOCKET_BUFFERED_INPUT_BYTES &&
        pendingInputRef.current.length === 0
      ) {
        try {
          socket.send(data);
          return;
        } catch {
          // Fall through to queued input.
        }
      }

      pendingInputRef.current.push(data);
      pendingInputBytesRef.current += terminalInputByteLength(data);
      while (
        pendingInputBytesRef.current > MAX_PENDING_INPUT_BYTES &&
        pendingInputRef.current.length > 0
      ) {
        const dropped = pendingInputRef.current.shift();
        if (!dropped) {
          break;
        }
        pendingInputBytesRef.current = Math.max(
          0,
          pendingInputBytesRef.current - terminalInputByteLength(dropped),
        );
      }
      if (inputFlushTimerRef.current == null) {
        inputFlushTimerRef.current = window.setTimeout(flushInput, 1);
      }
    };

    const pasteText = (text: string) => {
      if (!text) {
        return;
      }
      const normalizedText = text.replace(/\r?\n/g, "\r");
      if (modesRef.current.bracketedPaste) {
        sendInput(`\x1b[200~${normalizedText}\x1b[201~`);
      } else {
        sendInput(normalizedText);
      }
    };

    const copySelectedText = (clipboardData?: DataTransfer | null) => {
      const selectedText = selectedTextWithin(screenElement);
      if (!selectedText) {
        return false;
      }
      clipboardData?.setData("text/plain", selectedText);
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(selectedText).catch(() => undefined);
      }
      return true;
    };

    const resizeNow = () => {
      resizeFrameRef.current = null;
      const cellMetrics = syncCellMetrics();
      const size = sizeFromElement(screenElement, cellMetrics);
      if (!size) {
        return;
      }
      const { cols, rows } = size;
      const lastSize = lastSizeRef.current;
      if (lastSize?.cols === cols && lastSize.rows === rows) {
        return;
      }

      lastSizeRef.current = { cols, rows };
      const sessionId = sessionIdRef.current;
      if (sessionId) {
        void terminalResize(sessionId, cols, rows).catch(() => undefined);
      }
    };

    const scheduleResize = () => {
      if (resizeFrameRef.current == null) {
        resizeFrameRef.current = window.requestAnimationFrame(resizeNow);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTerminalHyperlinkEventTarget(event.target)) {
        return;
      }
      const key = event.key.toLowerCase();
      const usesClipboardShortcut = (event.ctrlKey || event.metaKey) && event.shiftKey;
      if (usesClipboardShortcut && key === "c") {
        event.preventDefault();
        copySelectedText();
        return;
      }
      if (usesClipboardShortcut && key === "v") {
        event.preventDefault();
        if (navigator.clipboard?.readText) {
          void navigator.clipboard.readText().then(pasteText).catch(() => undefined);
        }
        return;
      }
      const input = keyToTerminalInput(event, modesRef.current);
      if (input == null) {
        return;
      }
      event.preventDefault();
      sendInput(input);
    };

    const handleCopy = (event: ClipboardEvent) => {
      if (!copySelectedText(event.clipboardData)) {
        return;
      }
      event.preventDefault();
    };

    const handlePaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text/plain");
      if (!text) {
        return;
      }
      event.preventDefault();
      pasteText(text);
    };

    const handleFocus = () => {
      if (modesRef.current.focusInOut) {
        sendInput("\x1b[I");
      }
    };

    const handleBlur = () => {
      mouseButtonRef.current = null;
      if (modesRef.current.focusInOut) {
        sendInput("\x1b[O");
      }
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (isTerminalHyperlinkEventTarget(event.target)) {
        return;
      }
      if (!terminalMouseEnabled(modesRef.current)) {
        return;
      }
      const button = mouseButtonCode(event.button);
      if (button == null) {
        return;
      }
      event.preventDefault();
      screenElement.focus({ preventScroll: true });
      mouseButtonRef.current = button;
      const { col, row } = terminalMousePosition(
        event,
        screenElement,
        cellMetricsRef.current,
      );
      sendInput(
        terminalMouseSequence(
          modesRef.current,
          button + mouseModifierCode(event),
          col,
          row,
          true,
        ),
      );
    };

    const handleMouseUp = (event: MouseEvent) => {
      if (isTerminalHyperlinkEventTarget(event.target)) {
        return;
      }
      if (!terminalMouseEnabled(modesRef.current)) {
        return;
      }
      const button = mouseButtonRef.current ?? mouseButtonCode(event.button);
      if (button == null) {
        return;
      }
      event.preventDefault();
      mouseButtonRef.current = null;
      const { col, row } = terminalMousePosition(
        event,
        screenElement,
        cellMetricsRef.current,
      );
      sendInput(
        terminalMouseSequence(
          modesRef.current,
          button + mouseModifierCode(event),
          col,
          row,
          false,
        ),
      );
    };

    const handleMouseMove = (event: MouseEvent) => {
      const modes = modesRef.current;
      if (!terminalMouseEnabled(modes)) {
        return;
      }
      const activeButton = mouseButtonRef.current;
      const shouldReport =
        modes.mouseMotion || (modes.mouseDrag && activeButton != null);
      if (!shouldReport) {
        return;
      }
      event.preventDefault();
      const { col, row } = terminalMousePosition(
        event,
        screenElement,
        cellMetricsRef.current,
      );
      const baseButton = activeButton ?? 3;
      sendInput(
        terminalMouseSequence(
          modes,
          baseButton + 32 + mouseModifierCode(event),
          col,
          row,
          true,
        ),
      );
    };

    const handleWheel = (event: WheelEvent) => {
      if (terminalMouseEnabled(modesRef.current)) {
        // Application captures the mouse (vim, codex, tmux): forward wheel as
        // mouse escape sequences so the program scrolls its own view.
        event.preventDefault();
        const { col, row } = terminalMousePosition(
          event,
          screenElement,
          cellMetricsRef.current,
        );
        const direction = event.deltaY < 0 ? 64 : 65;
        sendInput(
          terminalMouseSequence(
            modesRef.current,
            direction + mouseModifierCode(event),
            col,
            row,
            true,
          ),
        );
        return;
      }
      // Plain shell: scroll the terminal scrollback. Wheel up (deltaY < 0) looks
      // back into history, which is a positive scroll delta in the Rust layer.
      const sessionId = sessionIdRef.current;
      if (!sessionId) {
        return;
      }
      event.preventDefault();
      wheelScrollAccumulatorRef.current += -normalizeWheelLines(
        event,
        cellMetricsRef.current,
        frameRef.current?.rows ?? MIN_TERMINAL_ROWS,
      );
      const delta =
        wheelScrollAccumulatorRef.current > 0
          ? Math.floor(wheelScrollAccumulatorRef.current)
          : Math.ceil(wheelScrollAccumulatorRef.current);
      if (delta === 0) {
        return;
      }
      wheelScrollAccumulatorRef.current -= delta;
      scrollTerminal(delta, delta > 0 ? "up" : "down");
    };

    const handleContextMenu = (event: MouseEvent) => {
      if (terminalMouseEnabled(modesRef.current)) {
        event.preventDefault();
      }
    };

    const resizeObserver = new ResizeObserver(scheduleResize);
    screenElement.addEventListener("keydown", handleKeyDown);
    screenElement.addEventListener("copy", handleCopy);
    screenElement.addEventListener("paste", handlePaste);
    screenElement.addEventListener("focus", handleFocus);
    screenElement.addEventListener("blur", handleBlur);
    screenElement.addEventListener("mousedown", handleMouseDown);
    screenElement.addEventListener("mouseup", handleMouseUp);
    screenElement.addEventListener("mousemove", handleMouseMove);
    // handleWheel calls preventDefault() to stop page zoom/scroll, so the
    // listener must stay non-passive; passive:true would silently ignore it.
    // oxlint-disable-next-line react-doctor/client-passive-event-listeners
    screenElement.addEventListener("wheel", handleWheel, { passive: false });
    screenElement.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener(settingsChangedEvent, scheduleResize);
    resizeObserver.observe(screenElement);

    async function start() {
      try {
        const existingSession = sessionRef.current;
        const cellMetrics = syncCellMetrics();
        const size = sizeFromElement(screenElement, cellMetrics);
        const session =
          existingSession ??
          (size
            ? await terminalSpawn(
                projectPath,
                null,
                size.cols,
                size.rows,
                terminalOptions,
              )
            : await terminalSpawn(projectPath, null, undefined, undefined, terminalOptions));
        if (disposed) {
          // Only kill a freshly spawned session; an existing live session must
          // keep running so it can be reconnected when the panel re-shows.
          if (!existingSession) {
            await terminalKill(session.id).catch(() => undefined);
          }
          return;
        }

        sessionIdRef.current = session.id;
        if (!existingSession) {
          onSessionReadyRef.current(session);
        }
        if (size) {
          lastSizeRef.current = size;
          if (existingSession) {
            // Keep the PTY sized to the current panel on reconnect, but only
            // when the panel has a real measured layout.
            void terminalResize(session.id, size.cols, size.rows).catch(() => undefined);
          }
        }
        const socket = new WebSocket(session.wsUrl);
        socketRef.current = socket;

        socket.onopen = () => {
          if (!disposed && socketRef.current === socket) {
            resizeNow();
            if (activeRef.current) {
              screenElement.focus({ preventScroll: true });
            }
            // Send any pending command (from runInTerminal) once the WebSocket
            // is open. The command is followed by Enter to execute it.
            if (pendingCommand && !pendingCommandSentRef.current) {
              pendingCommandSentRef.current = true;
              pendingInputRef.current.push(`${pendingCommand}\n`);
            }
            flushInput();
          }
        };
        socket.onmessage = (event) => {
          if (disposed || socketRef.current !== socket || typeof event.data !== "string") {
            return;
          }
          try {
            const message = JSON.parse(
              event.data,
            ) as TerminalFrame | TerminalClose | TerminalBell;
            if (message.type === "frame") {
              titleChangeRef.current(message.title ?? null);
              queueFrame(message);
            } else if (message.type === "bell") {
              triggerVisualBell();
            } else if (message.type === "close") {
              if (frameFlushRef.current != null) {
                window.cancelAnimationFrame(frameFlushRef.current);
                frameFlushRef.current = null;
              }
              const pendingFrame = pendingFrameRef.current;
              pendingFrameRef.current = null;
              if (pendingFrame) {
                frameRef.current = pendingFrame;
                setFrame(pendingFrame);
              }
              setClosed(message);
              onClosedRef.current(message.exitCode);
            }
          } catch {
            // Ignore malformed frames from an old dev backend.
          }
        };
        socket.onclose = () => {
          if (!disposed && socketRef.current === socket) {
            socketRef.current = null;
          }
        };
      } catch (error) {
        setClosed({ type: "close", exitCode: null });
        const errorFrame: TerminalFrame = {
          type: "frame",
          title: null,
          rows: 1,
          cols: 80,
          displayOffset: 0,
          cursorRow: 0,
          cursorCol: 0,
          cursorVisible: false,
          cursorShape: "block",
          modes: DEFAULT_TERMINAL_MODES,
          lines: [
            {
              cells: [
                {
                  text: String(error),
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
        frameRef.current = errorFrame;
        setFrame(errorFrame);
      }
    }

    void start();

    return () => {
      disposed = true;
      screenElement.removeEventListener("keydown", handleKeyDown);
      screenElement.removeEventListener("copy", handleCopy);
      screenElement.removeEventListener("paste", handlePaste);
      screenElement.removeEventListener("focus", handleFocus);
      screenElement.removeEventListener("blur", handleBlur);
      screenElement.removeEventListener("mousedown", handleMouseDown);
      screenElement.removeEventListener("mouseup", handleMouseUp);
      screenElement.removeEventListener("mousemove", handleMouseMove);
      screenElement.removeEventListener("wheel", handleWheel);
      screenElement.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener(settingsChangedEvent, scheduleResize);
      resizeObserver.disconnect();

      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close();
      }
      // Intentionally do NOT kill the PTY here. The terminal panel is
      // unmounted whenever the rail hides it, but the underlying process and
      // screen state must survive so the panel can reconnect on re-show.
      // PTYs are killed explicitly when a tab is closed or the shell exits.
      sessionIdRef.current = null;

      pendingInputRef.current = [];
      pendingInputBytesRef.current = 0;
      if (inputFlushTimerRef.current != null) {
        window.clearTimeout(inputFlushTimerRef.current);
        inputFlushTimerRef.current = null;
      }
      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      if (frameFlushRef.current != null) {
        window.cancelAnimationFrame(frameFlushRef.current);
        frameFlushRef.current = null;
      }
      if (scrollbackHintTimerRef.current != null) {
        window.clearTimeout(scrollbackHintTimerRef.current);
        scrollbackHintTimerRef.current = null;
      }
      if (visualBellTimerRef.current != null) {
        window.clearTimeout(visualBellTimerRef.current);
        visualBellTimerRef.current = null;
      }
      setBellActive(false);
      pendingFrameRef.current = null;
      lastSizeRef.current = null;
      frameRef.current = null;
      cellMetricsRef.current = DEFAULT_TERMINAL_CELL_METRICS;
      wheelScrollAccumulatorRef.current = 0;
      pendingScrollIntentRef.current = null;
      modesRef.current = DEFAULT_TERMINAL_MODES;
      mouseButtonRef.current = null;
      setJumpedScrollbackOffset(null);
    };
  }, [projectPath]);

  return (
    // role="application" hosts an interactive terminal surface that must capture
    // keyboard focus to relay keystrokes to the PTY; tabIndex is intentional.
    // oxlint-disable-next-line react-doctor/no-noninteractive-tabindex
    <div ref={screenRef} className="terminal-screen" role="application" aria-label="Terminal" tabIndex={0} onMouseDown={() => screenRef.current?.focus({ preventScroll: true })}>
      <div className={bellActive ? "terminal-output terminal-bell-flash" : "terminal-output"}>
        {frame ? <TerminalRows frame={frame} /> : null}
        {closed ? (
          <div className="terminal-close-line">
            {closed.exitCode == null
              ? "Terminal exited."
              : `Terminal exited with code ${closed.exitCode}.`}
          </div>
        ) : null}
      </div>
      {(frame?.displayOffset ?? 0) > 0 ? (
        <button
          type="button"
          className="terminal-scrollback-button"
          onClick={handleScrollToBottom}
        >
          Back to bottom
        </button>
      ) : null}
      {jumpedScrollbackOffset != null ? (
        <button
          type="button"
          className="terminal-scrollback-button terminal-scrollback-button-alert"
          onClick={handleRestoreScrollback}
        >
          New output. Restore scrollback
        </button>
      ) : null}
    </div>
  );
}

export function TerminalPanel({ active, projectPath }: TerminalPanelProps) {
  // Terminal workspaces live in a module-level store keyed by project path so
  // the live PTY sessions survive the panel being hidden (which unmounts this
  // whole stack) and can be reconnected when the panel is shown again.
  const activeProjectWorkspace = useSyncExternalStore(
    subscribeTerminalWorkspaces,
    () => (projectPath ? getTerminalWorkspace(projectPath) : EMPTY_WORKSPACE),
    () => EMPTY_WORKSPACE,
  );

  // Terminal options are read from the persisted settings so a new tab picks up
  // the latest shell/scrollback/cursor/bell choices. The settings window can
  // update these from another webview; subscribe to keep them in sync.
  const [terminalOptions, setTerminalOptions] = useState<TerminalSpawnOptions>(
    () => toTerminalSpawnOptions(loadAppSettings().terminal),
  );
  const [autoCloseOnExit, setAutoCloseOnExit] = useState(
    () => loadAppSettings().terminal.autoCloseOnExit,
  );
  useEffect(() => {
    setTerminalOptions(toTerminalSpawnOptions(loadAppSettings().terminal));
    setAutoCloseOnExit(loadAppSettings().terminal.autoCloseOnExit);
    const handler = () => {
      setTerminalOptions(toTerminalSpawnOptions(loadAppSettings().terminal));
      setAutoCloseOnExit(loadAppSettings().terminal.autoCloseOnExit);
    };
    window.addEventListener(settingsChangedEvent, handler);
    return () => window.removeEventListener(settingsChangedEvent, handler);
  }, []);

  if (!projectPath || !isTauriRuntime()) {
    const unavailableMessage = !projectPath
      ? "Open a folder first."
      : "Terminal is available in Tauri.";
    return (
      <section className="terminal-panel" aria-label="Terminal">
        <div className="terminal-empty">{unavailableMessage}</div>
      </section>
    );
  }

  const addTab = () => {
    addTerminalTab(projectPath);
  };

  const closeTab = (tabId: string) => {
    closeTerminalTab(projectPath, tabId, (session) => {
      void terminalKill(session.id).catch(() => undefined);
    });
  };

  const selectTab = (tabId: string) => {
    selectTerminalTab(projectPath, tabId);
  };

  const updateTabTitle = (tabId: string, title: string | null) => {
    setTerminalTabTitle(projectPath, tabId, title);
  };

  const handleSessionReady = (tabId: string, session: TerminalSessionInfo) => {
    setTerminalTabSession(projectPath, tabId, session);
  };

  const handleClosed = (tabId: string, exitCode: number | null) => {
    const workspace = getTerminalWorkspace(projectPath);
    const tab = workspace.tabs.find((entry) => entry.id === tabId);
    if (tab?.session) {
      void terminalKill(tab.session.id).catch(() => undefined);
    }
    if (autoCloseOnExit) {
      // Remove the tab outright so a closed process does not leave an exit-code
      // stub behind. Kill first (above) so the PTY is released before the tab
      // disappears from the workspace store.
      closeTerminalTab(projectPath, tabId, () => undefined);
      return;
    }
    setTerminalTabClosed(projectPath, tabId, exitCode);
  };

  const activeTab =
    activeProjectWorkspace.tabs.find(
      (tab) => tab.id === activeProjectWorkspace.activeTabId,
    ) ?? activeProjectWorkspace.tabs[0] ?? null;

  return (
    <section className="terminal-panel" aria-label="Terminal">
      <>
          <div className="terminal-header">
            <div className="terminal-header-title" aria-label="Terminal">
              <TerminalSquare size={14} />
            </div>
            <button
              type="button"
              className="terminal-tab-add"
              aria-label="New terminal"
              title="New terminal"
              onClick={addTab}
            >
              <Plus size={14} />
            </button>
            <div className="terminal-tabs" role="tablist" aria-label="Terminals">
              {activeProjectWorkspace.tabs.map((tab) => (
                <div
                  key={tab.id}
                  className={
                    tab.id === activeProjectWorkspace.activeTabId
                      ? "terminal-tab-shell terminal-tab-active"
                      : "terminal-tab-shell"
                  }
                >
                  <button
                    type="button"
                    className="terminal-tab"
                    role="tab"
                    aria-selected={tab.id === activeProjectWorkspace.activeTabId}
                    onClick={() => selectTab(tab.id)}
                  >
                    <span>{tab.title}</span>
                  </button>
                  <button
                    type="button"
                    className="terminal-tab-close"
                    aria-label={`Close ${tab.title}`}
                    onClick={() => closeTab(tab.id)}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="terminal-session-stack">
            {activeTab ? (
              <div className="terminal-session-layer">
                <TerminalSessionView
                  key={activeTab.id}
                  active={active}
                  projectPath={projectPath}
                  session={activeTab.session}
                  terminalOptions={terminalOptions}
                  pendingCommand={activeTab.pendingCommand}
                  onTitleChange={(title) => updateTabTitle(activeTab.id, title)}
                  onSessionReady={(session) => handleSessionReady(activeTab.id, session)}
                  onClosed={(exitCode) => handleClosed(activeTab.id, exitCode)}
                />
              </div>
            ) : null}
          </div>
        </>
    </section>
  );
}

const EMPTY_WORKSPACE: TerminalWorkspace = createInitialTerminalWorkspace();
