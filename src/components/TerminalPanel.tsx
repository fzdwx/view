import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Plus, TerminalSquare, X } from "lucide-react";
import {
  isTauriRuntime,
  terminalKill,
  terminalResize,
  terminalSpawn,
} from "../lib/api";

interface TerminalPanelProps {
  active: boolean;
  projectPath: string | null;
}

type TerminalTab = {
  id: string;
  baseTitle: string;
  title: string;
};

type TerminalWorkspace = {
  tabs: TerminalTab[];
  activeTabId: string;
  nextTabIndex: number;
};

type TerminalRun = {
  text: string;
  fg?: string | null;
  bg?: string | null;
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

type TerminalFrame = {
  type: "frame";
  title: string | null;
  rows: number;
  cols: number;
  cursorRow: number;
  cursorCol: number;
  cursorVisible: boolean;
  modes: TerminalModes;
  lines: TerminalLine[];
};

type TerminalClose = {
  type: "close";
  exitCode: number | null;
};

type TerminalInput = string | Uint8Array;

const CELL_WIDTH = 8;
const CELL_HEIGHT = 16;
const MAX_TERMINAL_COLS = 260;
const MAX_TERMINAL_ROWS = 120;
const MAX_PENDING_INPUT_BYTES = 32 * 1024;
const MAX_SOCKET_BUFFERED_INPUT_BYTES = 256 * 1024;
const TEXT_ENCODER = new TextEncoder();
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

function sizeFromElement(element: HTMLElement): { cols: number; rows: number } {
  const rect = element.getBoundingClientRect();
  const width = Number.isFinite(rect.width) ? rect.width : 0;
  const height = Number.isFinite(rect.height) ? rect.height : 0;

  return {
    cols: Math.min(
      MAX_TERMINAL_COLS,
      Math.max(20, Math.floor(width / CELL_WIDTH)),
    ),
    rows: Math.min(
      MAX_TERMINAL_ROWS,
      Math.max(6, Math.floor(height / CELL_HEIGHT)),
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
): { col: number; row: number } {
  const rect = element.getBoundingClientRect();
  const col = Math.floor((event.clientX - rect.left) / CELL_WIDTH) + 1;
  const row = Math.floor((event.clientY - rect.top) / CELL_HEIGHT) + 1;
  const { cols, rows } = sizeFromElement(element);

  return {
    col: Math.min(cols, Math.max(1, col)),
    row: Math.min(rows, Math.max(1, row)),
  };
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

function runStyle(run: TerminalRun): CSSProperties {
  return {
    color: run.fg ?? undefined,
    backgroundColor: run.bg ?? undefined,
    fontWeight: run.bold ? 760 : undefined,
    fontStyle: run.italic ? "italic" : undefined,
    opacity: run.dim ? 0.72 : undefined,
    textDecoration: run.underline ? "underline" : undefined,
    filter: run.inverse ? "invert(1)" : undefined,
  };
}

function renderRunWithCursor(
  run: TerminalRun,
  row: number,
  startCol: number,
  frame: TerminalFrame,
) {
  const text = run.text || " ";
  const cursorInRun =
    frame.cursorVisible &&
    frame.cursorRow === row &&
    frame.cursorCol >= startCol &&
    frame.cursorCol < startCol + text.length;
  const style = runStyle(run);

  if (!cursorInRun) {
    return (
      <span key={`${startCol}-${text.length}`} style={style}>
        {text}
      </span>
    );
  }

  const cursorIndex = frame.cursorCol - startCol;
  const before = text.slice(0, cursorIndex);
  const cursor = text[cursorIndex] || " ";
  const after = text.slice(cursorIndex + 1);

  return (
    <span key={`${startCol}-${text.length}`} style={style}>
      {before}
      <span className="terminal-cursor">{cursor}</span>
      {after}
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
              const startColumn = column;
              column += run.text.length || 1;
              return renderRunWithCursor(run, row, startColumn, frame);
            })}
            {frame.cursorVisible && frame.cursorRow === row && frame.cursorCol >= column ? (
              <>
                {" ".repeat(frame.cursorCol - column)}
                <span className="terminal-cursor"> </span>
              </>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

interface TerminalSessionViewProps {
  active: boolean;
  projectPath: string;
  onTitleChange(title: string | null): void;
}

function TerminalSessionView({
  active,
  projectPath,
  onTitleChange,
}: TerminalSessionViewProps) {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pendingInputRef = useRef<TerminalInput[]>([]);
  const pendingInputBytesRef = useRef(0);
  const inputFlushTimerRef = useRef<number | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const activeRef = useRef(active);
  const titleChangeRef = useRef(onTitleChange);
  const pendingFrameRef = useRef<TerminalFrame | null>(null);
  const frameFlushRef = useRef<number | null>(null);
  const modesRef = useRef<TerminalModes>(DEFAULT_TERMINAL_MODES);
  const mouseButtonRef = useRef<number | null>(null);
  const [frame, setFrame] = useState<TerminalFrame | null>(null);
  const [closed, setClosed] = useState<TerminalClose | null>(null);

  useEffect(() => {
    activeRef.current = active;
    titleChangeRef.current = onTitleChange;
    if (active) {
      screenRef.current?.focus({ preventScroll: true });
    }
  }, [active, onTitleChange]);

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

    const queueFrame = (nextFrame: TerminalFrame) => {
      const previousModes = modesRef.current;
      const nextModes = nextFrame.modes ?? DEFAULT_TERMINAL_MODES;
      modesRef.current = nextModes;
      if (
        !previousModes.focusInOut &&
        nextModes.focusInOut &&
        activeRef.current &&
        document.activeElement === screenElement
      ) {
        sendInput("\x1b[I");
      }
      pendingFrameRef.current = nextFrame;
      if (frameFlushRef.current != null) {
        return;
      }
      frameFlushRef.current = window.requestAnimationFrame(() => {
        frameFlushRef.current = null;
        const pendingFrame = pendingFrameRef.current;
        pendingFrameRef.current = null;
        if (!disposed && pendingFrame) {
          setClosed(null);
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

    const resizeNow = () => {
      resizeFrameRef.current = null;
      const { cols, rows } = sizeFromElement(screenElement);
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
      const input = keyToTerminalInput(event, modesRef.current);
      if (input == null) {
        return;
      }
      event.preventDefault();
      sendInput(input);
    };

    const handlePaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text/plain");
      if (!text) {
        return;
      }
      event.preventDefault();
      const normalizedText = text.replace(/\r?\n/g, "\r");
      if (modesRef.current.bracketedPaste) {
        sendInput(`\x1b[200~${normalizedText}\x1b[201~`);
      } else {
        sendInput(normalizedText);
      }
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
      const { col, row } = terminalMousePosition(event, screenElement);
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
      if (!terminalMouseEnabled(modesRef.current)) {
        return;
      }
      const button = mouseButtonRef.current ?? mouseButtonCode(event.button);
      if (button == null) {
        return;
      }
      event.preventDefault();
      mouseButtonRef.current = null;
      const { col, row } = terminalMousePosition(event, screenElement);
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
      const { col, row } = terminalMousePosition(event, screenElement);
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
      if (!terminalMouseEnabled(modesRef.current)) {
        return;
      }
      event.preventDefault();
      const { col, row } = terminalMousePosition(event, screenElement);
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
    };

    const handleContextMenu = (event: MouseEvent) => {
      if (terminalMouseEnabled(modesRef.current)) {
        event.preventDefault();
      }
    };

    const resizeObserver = new ResizeObserver(scheduleResize);
    screenElement.addEventListener("keydown", handleKeyDown);
    screenElement.addEventListener("paste", handlePaste);
    screenElement.addEventListener("focus", handleFocus);
    screenElement.addEventListener("blur", handleBlur);
    screenElement.addEventListener("mousedown", handleMouseDown);
    screenElement.addEventListener("mouseup", handleMouseUp);
    screenElement.addEventListener("mousemove", handleMouseMove);
    screenElement.addEventListener("wheel", handleWheel, { passive: false });
    screenElement.addEventListener("contextmenu", handleContextMenu);
    resizeObserver.observe(screenElement);

    async function start() {
      try {
        const { cols, rows } = sizeFromElement(screenElement);
        const session = await terminalSpawn(projectPath, null, cols, rows);
        if (disposed) {
          await terminalKill(session.id).catch(() => undefined);
          return;
        }

        sessionIdRef.current = session.id;
        const socket = new WebSocket(session.wsUrl);
        socketRef.current = socket;

        socket.onopen = () => {
          if (!disposed && socketRef.current === socket) {
            resizeNow();
            if (activeRef.current) {
              screenElement.focus({ preventScroll: true });
            }
            flushInput();
          }
        };
        socket.onmessage = (event) => {
          if (disposed || socketRef.current !== socket || typeof event.data !== "string") {
            return;
          }
          try {
            const message = JSON.parse(event.data) as TerminalFrame | TerminalClose;
            if (message.type === "frame") {
              titleChangeRef.current(message.title ?? null);
              queueFrame(message);
            } else if (message.type === "close") {
              if (frameFlushRef.current != null) {
                window.cancelAnimationFrame(frameFlushRef.current);
                frameFlushRef.current = null;
              }
              const pendingFrame = pendingFrameRef.current;
              pendingFrameRef.current = null;
              if (pendingFrame) {
                setFrame(pendingFrame);
              }
              setClosed(message);
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
        setFrame({
          type: "frame",
          title: null,
          rows: 1,
          cols: 80,
          cursorRow: 0,
          cursorCol: 0,
          cursorVisible: false,
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
        });
      }
    }

    void start();

    return () => {
      disposed = true;
      screenElement.removeEventListener("keydown", handleKeyDown);
      screenElement.removeEventListener("paste", handlePaste);
      screenElement.removeEventListener("focus", handleFocus);
      screenElement.removeEventListener("blur", handleBlur);
      screenElement.removeEventListener("mousedown", handleMouseDown);
      screenElement.removeEventListener("mouseup", handleMouseUp);
      screenElement.removeEventListener("mousemove", handleMouseMove);
      screenElement.removeEventListener("wheel", handleWheel);
      screenElement.removeEventListener("contextmenu", handleContextMenu);
      resizeObserver.disconnect();

      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close();
      }
      if (sessionId) {
        void terminalKill(sessionId).catch(() => undefined);
      }

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
      pendingFrameRef.current = null;
      lastSizeRef.current = null;
      modesRef.current = DEFAULT_TERMINAL_MODES;
      mouseButtonRef.current = null;
    };
  }, [projectPath]);

  return (
    <div
      ref={screenRef}
      className="terminal-screen"
      tabIndex={0}
      onMouseDown={() => screenRef.current?.focus({ preventScroll: true })}
    >
      <div className="terminal-output">
        {frame ? <TerminalRows frame={frame} /> : null}
        {closed ? (
          <div className="terminal-close-line">
            {closed.exitCode == null
              ? "Terminal exited."
              : `Terminal exited with code ${closed.exitCode}.`}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function TerminalPanel({ active, projectPath }: TerminalPanelProps) {
  const [workspaces, setWorkspaces] = useState<Record<string, TerminalWorkspace>>({});
  const unavailableMessage = !projectPath
    ? "Open a repository first."
    : !isTauriRuntime()
      ? "Terminal is available in Tauri."
      : null;
  const activeWorkspace = projectPath
    ? (workspaces[projectPath] ?? createInitialTerminalWorkspace())
    : null;
  const workspaceEntries: Array<[string, TerminalWorkspace]> =
    projectPath && activeWorkspace && !workspaces[projectPath]
      ? [...Object.entries(workspaces), [projectPath, activeWorkspace]]
      : Object.entries(workspaces);

  useEffect(() => {
    if (!projectPath || !isTauriRuntime()) {
      return;
    }

    setWorkspaces((currentWorkspaces) =>
      currentWorkspaces[projectPath]
        ? currentWorkspaces
        : {
            ...currentWorkspaces,
            [projectPath]: createInitialTerminalWorkspace(),
          },
    );
  }, [projectPath]);

  const addTab = () => {
    if (!projectPath) {
      return;
    }

    setWorkspaces((currentWorkspaces) => {
      const workspace = currentWorkspaces[projectPath] ?? createInitialTerminalWorkspace();
      const nextIndex = workspace.nextTabIndex + 1;
      const tab = {
        id: `terminal-${Date.now()}-${nextIndex}`,
        baseTitle: `Terminal ${nextIndex}`,
        title: `Terminal ${nextIndex}`,
      };

      return {
        ...currentWorkspaces,
        [projectPath]: {
          tabs: [...workspace.tabs, tab],
          activeTabId: tab.id,
          nextTabIndex: nextIndex,
        },
      };
    });
  };

  const closeTab = (tabId: string) => {
    if (!projectPath) {
      return;
    }

    setWorkspaces((currentWorkspaces) => {
      const workspace = currentWorkspaces[projectPath];
      if (!workspace) {
        return currentWorkspaces;
      }

      const index = workspace.tabs.findIndex((tab) => tab.id === tabId);
      if (index < 0) {
        return currentWorkspaces;
      }

      const nextTabs = workspace.tabs.filter((tab) => tab.id !== tabId);
      const fallback = nextTabs[Math.max(0, index - 1)] ?? nextTabs[0] ?? null;
      return {
        ...currentWorkspaces,
        [projectPath]: {
          ...workspace,
          tabs: nextTabs,
          activeTabId:
            workspace.activeTabId === tabId
              ? (fallback?.id ?? "")
              : workspace.activeTabId,
        },
      };
    });
  };

  const selectTab = (tabId: string) => {
    if (!projectPath) {
      return;
    }

    setWorkspaces((currentWorkspaces) => {
      const workspace = currentWorkspaces[projectPath];
      if (!workspace) {
        return currentWorkspaces;
      }

      return {
        ...currentWorkspaces,
        [projectPath]: {
          ...workspace,
          activeTabId: tabId,
        },
      };
    });
  };

  const updateTabTitle = (tabId: string, title: string | null) => {
    if (!projectPath) {
      return;
    }

    setWorkspaces((currentWorkspaces) => {
      const workspace = currentWorkspaces[projectPath];
      if (!workspace) {
        return currentWorkspaces;
      }

      let changed = false;
      const nextTabs = workspace.tabs.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }
        const nextTitle = title?.trim() || tab.baseTitle;
        if (tab.title === nextTitle) {
          return tab;
        }
        changed = true;
        return {
          ...tab,
          title: nextTitle,
        };
      });

      if (!changed) {
        return currentWorkspaces;
      }

      return {
        ...currentWorkspaces,
        [projectPath]: {
          ...workspace,
          tabs: nextTabs,
        },
      };
    });
  };

  return (
    <section className="terminal-panel" aria-label="Terminal">
      {unavailableMessage ? (
        <div className="terminal-empty">{unavailableMessage}</div>
      ) : (
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
              {activeWorkspace?.tabs.map((tab) => (
                <div
                  key={tab.id}
                  className={
                    tab.id === activeWorkspace.activeTabId
                      ? "terminal-tab-shell terminal-tab-active"
                      : "terminal-tab-shell"
                  }
                >
                  <button
                    type="button"
                    className="terminal-tab"
                    role="tab"
                    aria-selected={tab.id === activeWorkspace.activeTabId}
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
            {activeWorkspace?.tabs.length === 0 ? (
              <button type="button" className="terminal-new-empty" onClick={addTab}>
                New terminal
              </button>
            ) : (
              workspaceEntries.flatMap(([workspaceProjectPath, workspace]) =>
                workspace.tabs.map((tab) => {
                  const isActiveProject = workspaceProjectPath === projectPath;
                  const isActiveTab = tab.id === workspace.activeTabId;
                  return (
                    <div
                      key={`${workspaceProjectPath}:${tab.id}`}
                      className={
                        isActiveProject && isActiveTab
                          ? "terminal-session-layer"
                          : "terminal-session-layer terminal-session-layer-hidden"
                      }
                      aria-hidden={!isActiveProject || !isActiveTab}
                    >
                      <TerminalSessionView
                        active={active && isActiveProject && isActiveTab}
                        projectPath={workspaceProjectPath}
                        onTitleChange={(title) => updateTabTitle(tab.id, title)}
                      />
                    </div>
                  );
                }),
              )
            )}
          </div>
        </>
      )}
    </section>
  );
}

function createInitialTerminalWorkspace(): TerminalWorkspace {
  return {
    tabs: [{ id: "terminal-1", baseTitle: "Terminal 1", title: "Terminal 1" }],
    activeTabId: "terminal-1",
    nextTabIndex: 1,
  };
}
