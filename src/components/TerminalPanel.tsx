import { memo, Profiler, useEffect, useRef } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ProfilerOnRenderCallback,
  ReactNode,
} from "react";
import {
  isTauriRuntime,
  openExternalUrl,
} from "../lib/api";
import type { TerminalSpawnOptions } from "../lib/api";
import { useTerminalSession } from "../hooks/useTerminalSession";
import { useTerminalWorkspace } from "../hooks/useTerminalWorkspace";
import {
  terminalBlockRects,
  terminalBoxSegments,
  type TerminalBlockRect,
  type TerminalBoxSegments,
} from "../lib/terminalGlyphs";
import { terminalRunStyle } from "../lib/terminalRunStyle";
import {
  DEFAULT_TERMINAL_CELL_METRICS,
  type TerminalCursorStyle,
  type TerminalFrame,
  type TerminalLine,
  type TerminalRun,
} from "../lib/terminalTypes";
import { logPerf } from "../lib/performanceLog";
import { terminalFramePerfFields } from "../lib/terminalPerf";
import type { TerminalSessionInfo } from "../lib/terminalSessions";
import { TerminalTabStrip } from "./terminal/TerminalTabStrip";

interface TerminalPanelProps {
  active: boolean;
  projectPath: string | null;
}

const terminalGraphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;
const EMOJI_GRAPHEME_PATTERN =
  /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{20E3}\u{FE0F}]/u;
const TERMINAL_WIDE_GRAPHEME_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u{1100}-\u{115F}\u{2329}\u{232A}\u{2E80}-\u{303F}\u{3040}-\u{A4CF}\u{AC00}-\u{D7A3}\u{F900}-\u{FAFF}\u{FE10}-\u{FE19}\u{FE30}-\u{FE6F}\u{FF01}-\u{FF60}\u{FFE0}-\u{FFE6}]/u;
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

type TerminalCursorFrame = Pick<
  TerminalFrame,
  "cursorCol" | "cursorRow" | "cursorShape" | "cursorVisible"
>;

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
  frame: TerminalCursorFrame,
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
  readonly frame: TerminalCursorFrame;
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

interface TerminalLineViewProps {
  readonly cursorCol: number;
  readonly cursorRow: number;
  readonly cursorShape: TerminalCursorStyle;
  readonly cursorVisible: boolean;
  readonly line: TerminalLine;
  readonly row: number;
}

const TerminalLineView = memo(
  function TerminalLineView({
    cursorCol,
    cursorRow,
    cursorShape,
    cursorVisible,
    line,
    row,
  }: TerminalLineViewProps) {
    let column = 0;
    const frameCursor = {
      cursorCol,
      cursorRow,
      cursorShape,
      cursorVisible,
    } satisfies TerminalCursorFrame;

    return (
      <div className="terminal-line">
        {line.cells.map((run) => {
          const graphemes = splitTerminalGraphemes(run.text || " ");
          const startColumn = column;
          column += terminalTextColumns(graphemes);
          return renderRunWithCursor(
            run,
            row,
            startColumn,
            frameCursor,
            graphemes,
          );
        })}
        <TrailingCursor row={row} frame={frameCursor} renderedColumns={column} />
      </div>
    );
  },
  areTerminalLinePropsEqual,
);

function TerminalRows({ frame }: { frame: TerminalFrame }) {
  return (
    <>
      {frame.lines.map((line, row) => (
        <TerminalLineView
          key={row}
          cursorCol={frame.cursorCol}
          cursorRow={frame.cursorRow}
          cursorShape={frame.cursorShape}
          cursorVisible={frame.cursorVisible}
          line={line}
          row={row}
        />
      ))}
    </>
  );
}

const onTerminalRender: ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration,
  baseDuration,
) => {
  logPerf("terminal:react-render", actualDuration, {
    id,
    phase,
    baseMs: Math.round(baseDuration * 10) / 10,
  });
};

function areTerminalLinePropsEqual(
  previous: Readonly<TerminalLineViewProps>,
  next: Readonly<TerminalLineViewProps>,
): boolean {
  if (previous.row !== next.row) {
    return false;
  }

  const previousCursorOnLine =
    previous.cursorVisible && previous.cursorRow === previous.row;
  const nextCursorOnLine = next.cursorVisible && next.cursorRow === next.row;
  if (previousCursorOnLine || nextCursorOnLine) {
    if (
      previousCursorOnLine !== nextCursorOnLine ||
      previous.cursorCol !== next.cursorCol ||
      previous.cursorShape !== next.cursorShape
    ) {
      return false;
    }
  }

  return terminalLinesEqual(previous.line, next.line);
}

function terminalLinesEqual(
  previous: TerminalLine,
  next: TerminalLine,
): boolean {
  if (previous === next) {
    return true;
  }
  if (previous.cells.length !== next.cells.length) {
    return false;
  }

  for (let index = 0; index < previous.cells.length; index += 1) {
    if (!terminalRunsEqual(previous.cells[index], next.cells[index])) {
      return false;
    }
  }
  return true;
}

function terminalRunsEqual(previous: TerminalRun, next: TerminalRun): boolean {
  return (
    previous.text === next.text &&
    previous.fg === next.fg &&
    previous.bg === next.bg &&
    previous.href === next.href &&
    previous.bold === next.bold &&
    previous.dim === next.dim &&
    previous.italic === next.italic &&
    previous.underline === next.underline &&
    previous.inverse === next.inverse
  );
}

export interface TerminalSessionViewProps {
  active: boolean;
  cwd: string | null;
  projectPath: string;
  /** Existing live PTY session to reconnect to, or null to spawn a new one. */
  session: TerminalSessionInfo | null;
  terminalOptions: TerminalSpawnOptions;
  /** Command to send to the PTY once the WebSocket is open. */
  pendingCommand: string | null;
  onTitleChange(title: string | null): void;
  onSessionReady(session: TerminalSessionInfo): void;
  onPendingCommandSent(): void;
  onClosed(exitCode: number | null): void;
  onWorkingDirectoryChange(cwd: string | null): void;
}

export function TerminalSessionView({
  active,
  cwd,
  projectPath,
  session,
  terminalOptions,
  pendingCommand,
  onTitleChange,
  onSessionReady,
  onPendingCommandSent,
  onClosed,
  onWorkingDirectoryChange,
}: TerminalSessionViewProps) {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const {
    bellActive,
    closed,
    frame,
    handleRestoreScrollback,
    handleScrollToBottom,
    jumpedScrollbackOffset,
  } = useTerminalSession({
    active,
    cwd,
    projectPath,
    session,
    terminalOptions,
    pendingCommand,
    screenRef,
    onTitleChange,
    onSessionReady,
    onPendingCommandSent,
    onClosed,
    onWorkingDirectoryChange,
  });

  return (
    <div
      ref={screenRef}
      className="terminal-screen"
      role="application"
      aria-label="Terminal"
      // Custom PTY viewport: keyboard focus drives terminal input, mouse
      // reporting, and interactive TUI programs.
      // oxlint-disable-next-line react-doctor/no-noninteractive-tabindex
      tabIndex={0}
      onMouseDown={() => screenRef.current?.focus({ preventScroll: true })}
    >
      <div className={bellActive ? "terminal-output terminal-bell-flash" : "terminal-output"}>
        {frame ? (
          <Profiler id="TerminalRows" onRender={onTerminalRender}>
            <TerminalRows frame={frame} />
          </Profiler>
        ) : null}
        {frame ? (
          <TerminalRenderStats frame={frame} />
        ) : null}
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

function TerminalRenderStats({ frame }: { readonly frame: TerminalFrame }) {
  useEffect(() => {
    logPerf("terminal:render-input", 0, () => terminalFramePerfFields(frame));
  }, [frame]);

  return null;
}

export function TerminalPanel({ active, projectPath }: TerminalPanelProps) {
  const terminalWorkspace = useTerminalWorkspace(projectPath);

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

  return (
    <section className="terminal-panel" aria-label="Terminal">
      <TerminalTabStrip
        activeTabId={terminalWorkspace.activePanelTab?.id ?? ""}
        projectPath={projectPath}
        tabs={terminalWorkspace.panelTabs}
        onAddTab={terminalWorkspace.addTab}
        onCloseTab={terminalWorkspace.closeTab}
        onSelectTab={terminalWorkspace.selectTab}
      />
      <div className="terminal-session-stack">
        {terminalWorkspace.activePanelTab ? (
          <div className="terminal-session-layer">
            <TerminalSessionView
              key={terminalWorkspace.activePanelTab.id}
              active={active}
              cwd={terminalWorkspace.activePanelTab.cwd}
              projectPath={projectPath}
              session={terminalWorkspace.activePanelTab.session}
              terminalOptions={terminalWorkspace.terminalOptions}
              pendingCommand={terminalWorkspace.activePanelTab.pendingCommand}
              onTitleChange={(title) =>
                terminalWorkspace.updateTabTitle(
                  terminalWorkspace.activePanelTab?.id ?? "",
                  title,
                )
              }
              onWorkingDirectoryChange={(cwd) =>
                terminalWorkspace.updateTabCwd(
                  terminalWorkspace.activePanelTab?.id ?? "",
                  cwd,
                )
              }
              onSessionReady={(session) =>
                terminalWorkspace.handleSessionReady(
                  terminalWorkspace.activePanelTab?.id ?? "",
                  session,
                )
              }
              onPendingCommandSent={() =>
                terminalWorkspace.handlePendingCommandSent(
                  terminalWorkspace.activePanelTab?.id ?? "",
                )
              }
              onClosed={(exitCode) =>
                terminalWorkspace.handleClosed(
                  terminalWorkspace.activePanelTab?.id ?? "",
                  exitCode,
                )
              }
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}
