import { useEffect } from "react";
import type { RefObject } from "react";
import {
  isTauriRuntime,
  terminalKill,
  terminalResize,
  terminalSpawn,
  type TerminalSpawnOptions,
} from "../lib/api";
import {
  attachTerminalScreenHandlers,
  type TerminalScrollDirection,
} from "../lib/terminalScreenHandlers";
import {
  closeTerminalSocket,
  connectTerminalSocket,
} from "../lib/terminalSocketConnection";
import {
  createTerminalErrorFrame,
} from "../lib/terminalSocketMessage";
import type { TerminalSessionInfo } from "../lib/terminalSessions";
import {
  DEFAULT_TERMINAL_CELL_METRICS,
  type TerminalCellMetrics,
  type TerminalFrame,
  type TerminalInput,
  type TerminalModes,
  type TerminalClose,
} from "../lib/terminalTypes";
import {
  measureTerminalCellMetrics,
  sizeFromElement,
} from "../lib/terminalViewport";
import { settingsChangedEvent } from "../lib/settings";
import {
  isPanelResizeInProgress,
} from "../lib/panelResizeInteraction";

const TERMINAL_RESIZE_DEBOUNCE_MS = 120;
const TERMINAL_LIVE_PANEL_RESIZE_DEBOUNCE_MS = 32;

type MutableRef<T> = {
  current: T;
};

export interface TerminalSessionLifecycleOptions {
  readonly activeRef: MutableRef<boolean>;
  readonly cellMetricsRef: MutableRef<TerminalCellMetrics>;
  readonly cwdRef: MutableRef<string | null>;
  readonly flushInput: () => void;
  readonly flushPendingFrame: () => void;
  readonly frameRef: RefObject<TerminalFrame | null>;
  readonly lastSizeRef: MutableRef<{ readonly cols: number; readonly rows: number } | null>;
  readonly modesRef: RefObject<TerminalModes>;
  readonly mouseButtonRef: MutableRef<number | null>;
  readonly onClosedRef: MutableRef<(exitCode: number | null) => void>;
  readonly onPendingCommandSentRef: MutableRef<() => void>;
  readonly onSessionReadyRef: MutableRef<(session: TerminalSessionInfo) => void>;
  readonly pendingCommandRef: MutableRef<string | null>;
  readonly pendingCommandSentRef: MutableRef<boolean>;
  readonly projectPath: string;
  readonly queueFrame: (
    frame: TerminalFrame,
    element: HTMLElement,
    sendInput: (data: TerminalInput | null) => void,
  ) => void;
  readonly resetInputQueue: () => void;
  readonly resetVisualState: () => void;
  readonly resizeFrameRef: MutableRef<number | null>;
  readonly screenRef: RefObject<HTMLDivElement | null>;
  readonly scrollTerminal: (delta: number, direction: TerminalScrollDirection) => void;
  readonly sendInput: (data: TerminalInput | null) => void;
  readonly sessionIdRef: MutableRef<string | null>;
  readonly sessionRef: MutableRef<TerminalSessionInfo | null>;
  readonly setClosedState: (closed: TerminalClose | null) => void;
  readonly setFrameState: (frame: TerminalFrame) => void;
  readonly socketRef: MutableRef<WebSocket | null>;
  readonly socketCwdRef: MutableRef<string | null>;
  readonly socketTitleRef: MutableRef<string | null>;
  readonly terminalOptionsRef: MutableRef<TerminalSpawnOptions>;
  readonly titleChangeRef: MutableRef<(title: string | null) => void>;
  readonly workingDirectoryChangeRef: MutableRef<(cwd: string | null) => void>;
  readonly triggerVisualBell: () => void;
  readonly wheelScrollAccumulatorRef: MutableRef<number>;
}

export function useTerminalSessionLifecycle(options: TerminalSessionLifecycleOptions): void {
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    const screenElement = options.screenRef.current;
    if (!screenElement) {
      return;
    }
    const terminalElement = screenElement;
    let disposed = false;
    const disposedRef = {
      get current() {
        return disposed;
      },
    };
    const syncCellMetrics = () => {
      const nextMetrics = measureTerminalCellMetrics(terminalElement);
      options.cellMetricsRef.current = nextMetrics;
      terminalElement.style.setProperty("--terminal-cell-width", `${nextMetrics.width}px`);
      terminalElement.style.setProperty("--terminal-cell-height", `${nextMetrics.height}px`);
      return nextMetrics;
    };
    const syncCellMetricsAndScheduleResize = () => {
      syncCellMetrics();
      scheduleResize();
    };
    let resizeDebounceTimer: number | null = null;
    let resizeInFlight = false;
    let pendingResize: { readonly cols: number; readonly rows: number } | null = null;
    const sendResize = (sessionId: string, size: { readonly cols: number; readonly rows: number }) => {
      if (resizeInFlight) {
        pendingResize = size;
        return;
      }

      resizeInFlight = true;
      void ignoreTerminalLifecycleFailure(
        terminalResize(sessionId, size.cols, size.rows),
      ).then(() => {
        resizeInFlight = false;
        if (disposed) {
          pendingResize = null;
          return;
        }

        const nextSize = pendingResize;
        if (resizeDebounceTimer != null) {
          return;
        }
        pendingResize = null;
        const currentSessionId = options.sessionIdRef.current;
        if (nextSize && currentSessionId) {
          sendResize(currentSessionId, nextSize);
        }
      });
    };
    const queueResize = (sessionId: string, size: { readonly cols: number; readonly rows: number }) => {
      if (isPanelResizeInProgress() && !resizeInFlight && resizeDebounceTimer == null) {
        pendingResize = null;
        sendResize(sessionId, size);
        return;
      }

      pendingResize = size;
      if (resizeDebounceTimer != null) {
        window.clearTimeout(resizeDebounceTimer);
      }
      const debounceMs = isPanelResizeInProgress()
        ? TERMINAL_LIVE_PANEL_RESIZE_DEBOUNCE_MS
        : TERMINAL_RESIZE_DEBOUNCE_MS;
      resizeDebounceTimer = window.setTimeout(() => {
        resizeDebounceTimer = null;
        const nextSize = pendingResize;
        pendingResize = null;
        const currentSessionId = options.sessionIdRef.current ?? sessionId;
        if (nextSize) {
          sendResize(currentSessionId, nextSize);
        }
      }, debounceMs);
    };
    const resizeNow = () => {
      options.resizeFrameRef.current = null;
      const size = sizeFromElement(
        terminalElement,
        options.cellMetricsRef.current,
      );
      if (!size || sameSize(options.lastSizeRef.current, size)) {
        return;
      }
      options.lastSizeRef.current = size;
      const sessionId = options.sessionIdRef.current;
      if (sessionId) {
        queueResize(sessionId, size);
      }
    };
    const scheduleResize = () => {
      if (options.resizeFrameRef.current == null) {
        options.resizeFrameRef.current = window.requestAnimationFrame(resizeNow);
      }
    };
    const detachHandlers = attachTerminalScreenHandlers({
      cellMetricsRef: options.cellMetricsRef,
      frameRef: options.frameRef,
      modesRef: options.modesRef,
      mouseButtonRef: options.mouseButtonRef,
      screenElement: terminalElement,
      scrollTerminal: options.scrollTerminal,
      sendInput: options.sendInput,
      wheelScrollAccumulatorRef: options.wheelScrollAccumulatorRef,
    });
    const resizeObserver = new ResizeObserver(scheduleResize);
    window.addEventListener(settingsChangedEvent, syncCellMetricsAndScheduleResize);
    resizeObserver.observe(terminalElement);

    const start = async () => {
      try {
        const existingSession = options.sessionRef.current;
        const size = sizeFromElement(terminalElement, syncCellMetrics());
        const nextSession =
          existingSession ??
          (size
            ? await terminalSpawn(
                options.projectPath,
                options.cwdRef.current,
                size.cols,
                size.rows,
                options.terminalOptionsRef.current,
              )
            : await terminalSpawn(
                options.projectPath,
                options.cwdRef.current,
                undefined,
                undefined,
                options.terminalOptionsRef.current,
              ));
        if (disposed) {
          if (!existingSession) {
            await ignoreTerminalLifecycleFailure(terminalKill(nextSession.id));
          }
          return;
        }
        options.sessionIdRef.current = nextSession.id;
        if (!existingSession) {
          options.onSessionReadyRef.current(nextSession);
        }
        if (size) {
          options.lastSizeRef.current = size;
          if (existingSession) {
            sendResize(nextSession.id, size);
          }
        }
        connectTerminalSocket(nextSession.wsUrl, terminalElement, resizeNow, disposedRef, options);
      } catch (error) {
        const frameError =
          error instanceof Error || typeof error === "string"
            ? error
            : new Error("Terminal startup failed");
        options.setClosedState({ type: "close", exitCode: null });
        options.setFrameState(createTerminalErrorFrame(frameError));
      }
    };

    void start();
    return () => {
      disposed = true;
      detachHandlers();
      window.removeEventListener(
        settingsChangedEvent,
        syncCellMetricsAndScheduleResize,
      );
      resizeObserver.disconnect();
      closeTerminalSocket(options.socketRef);
      options.sessionIdRef.current = null;
      options.resetInputQueue();
      if (options.resizeFrameRef.current != null) {
        window.cancelAnimationFrame(options.resizeFrameRef.current);
        options.resizeFrameRef.current = null;
      }
      if (resizeDebounceTimer != null) {
        window.clearTimeout(resizeDebounceTimer);
        resizeDebounceTimer = null;
      }
      options.lastSizeRef.current = null;
      options.cellMetricsRef.current = DEFAULT_TERMINAL_CELL_METRICS;
      options.wheelScrollAccumulatorRef.current = 0;
      options.mouseButtonRef.current = null;
      options.resetVisualState();
    };
  }, [
    options.activeRef,
    options.cellMetricsRef,
    options.cwdRef,
    options.flushInput,
    options.flushPendingFrame,
    options.frameRef,
    options.lastSizeRef,
    options.modesRef,
    options.mouseButtonRef,
    options.onClosedRef,
    options.onPendingCommandSentRef,
    options.onSessionReadyRef,
    options.pendingCommandRef,
    options.pendingCommandSentRef,
    options.projectPath,
    options.queueFrame,
    options.resetInputQueue,
    options.resetVisualState,
    options.resizeFrameRef,
    options.screenRef,
    options.scrollTerminal,
    options.sendInput,
    options.sessionIdRef,
    options.sessionRef,
    options.setClosedState,
    options.setFrameState,
    options.socketRef,
    options.socketCwdRef,
    options.socketTitleRef,
    options.terminalOptionsRef,
    options.titleChangeRef,
    options.workingDirectoryChangeRef,
    options.triggerVisualBell,
    options.wheelScrollAccumulatorRef,
  ]);
}

function sameSize(
  left: { readonly cols: number; readonly rows: number } | null,
  right: { readonly cols: number; readonly rows: number },
): boolean {
  return left?.cols === right.cols && left.rows === right.rows;
}

async function ignoreTerminalLifecycleFailure(operation: Promise<void>): Promise<void> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof Error || typeof error === "string") {
      return;
    }
    throw error;
  }
}
