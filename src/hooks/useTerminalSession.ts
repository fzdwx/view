import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import { terminalScroll, type TerminalSpawnOptions } from "../lib/api";
import type { TerminalSessionInfo } from "../lib/terminalSessions";
import {
  DEFAULT_TERMINAL_CELL_METRICS,
  type TerminalCellMetrics,
} from "../lib/terminalTypes";
import { useTerminalInputQueue } from "./useTerminalInputQueue";
import { useTerminalSessionLifecycle } from "./useTerminalSessionLifecycle";
import { useTerminalVisualState } from "./useTerminalVisualState";

export interface TerminalSessionOptions {
  readonly active: boolean;
  readonly cwd: string | null;
  readonly onClosed: (exitCode: number | null) => void;
  readonly onPendingCommandSent: () => void;
  readonly onSessionReady: (session: TerminalSessionInfo) => void;
  readonly onTitleChange: (title: string | null) => void;
  readonly onWorkingDirectoryChange: (cwd: string | null) => void;
  readonly pendingCommand: string | null;
  readonly projectPath: string;
  readonly screenRef: RefObject<HTMLDivElement | null>;
  readonly session: TerminalSessionInfo | null;
  readonly terminalOptions: TerminalSpawnOptions;
}

export function useTerminalSession(options: TerminalSessionOptions) {
  const {
    active,
    cwd,
    onClosed,
    onPendingCommandSent,
    onSessionReady,
    onTitleChange,
    onWorkingDirectoryChange,
    pendingCommand,
    projectPath,
    screenRef,
    session,
    terminalOptions,
  } = options;
  const socketRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pendingCommandSentRef = useRef(false);
  const activeRef = useRef(active);
  const sessionRef = useRef<TerminalSessionInfo | null>(session);
  const cwdRef = useRef<string | null>(cwd);
  const socketCwdRef = useRef<string | null>(cwd);
  const socketTitleRef = useRef<string | null>(null);
  const titleChangeRef = useRef(onTitleChange);
  const workingDirectoryChangeRef = useRef(onWorkingDirectoryChange);
  const onSessionReadyRef = useRef(onSessionReady);
  const onPendingCommandSentRef = useRef(onPendingCommandSent);
  const onClosedRef = useRef(onClosed);
  const terminalOptionsRef = useRef(terminalOptions);
  const pendingCommandRef = useRef(pendingCommand);
  const cellMetricsRef = useRef<TerminalCellMetrics>(DEFAULT_TERMINAL_CELL_METRICS);
  const lastSizeRef = useRef<{ readonly cols: number; readonly rows: number } | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const mouseButtonRef = useRef<number | null>(null);
  const wheelScrollAccumulatorRef = useRef(0);
  const { flushInput, resetInputQueue, sendInput } = useTerminalInputQueue(socketRef);
  const visualState = useTerminalVisualState();
  const {
    bellActive,
    clearScrollbackHint,
    closed,
    flushPendingFrame,
    frame,
    frameRef,
    jumpedScrollbackOffset,
    markPendingScrollIntent,
    modesRef,
    queueFrame,
    resetVisualState,
    setClosedState,
    setFrameState,
    triggerVisualBell,
  } = visualState;

  useEffect(() => {
    activeRef.current = active;
    cwdRef.current = cwd;
    sessionRef.current = session;
    titleChangeRef.current = onTitleChange;
    workingDirectoryChangeRef.current = onWorkingDirectoryChange;
    onSessionReadyRef.current = onSessionReady;
    onPendingCommandSentRef.current = onPendingCommandSent;
    onClosedRef.current = onClosed;
    terminalOptionsRef.current = terminalOptions;
    pendingCommandRef.current = pendingCommand;
  }, [
    active,
    cwd,
    onClosed,
    onPendingCommandSent,
    onSessionReady,
    onTitleChange,
    onWorkingDirectoryChange,
    pendingCommand,
    session,
    terminalOptions,
  ]);

  useEffect(() => {
    if (active) {
      screenRef.current?.focus({ preventScroll: true });
    }
  }, [active, screenRef]);

  const scrollTerminal = useCallback(
    (delta: number, direction: "up" | "down" | "bottom") => {
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
    },
    [clearScrollbackHint, markPendingScrollIntent],
  );

  const handleScrollToBottom = useCallback(() => {
    const displayOffset = frameRef.current?.displayOffset ?? 0;
    if (displayOffset > 0) {
      scrollTerminal(-displayOffset, "bottom");
    }
  }, [frameRef, scrollTerminal]);

  const handleRestoreScrollback = useCallback(() => {
    if (jumpedScrollbackOffset == null || jumpedScrollbackOffset <= 0) {
      return;
    }
    scrollTerminal(jumpedScrollbackOffset, "up");
    clearScrollbackHint();
  }, [clearScrollbackHint, jumpedScrollbackOffset, scrollTerminal]);

  useTerminalSessionLifecycle({
    activeRef,
    cellMetricsRef,
    cwdRef,
    flushInput,
    flushPendingFrame,
    frameRef,
    lastSizeRef,
    modesRef,
    mouseButtonRef,
    onClosedRef,
    onPendingCommandSentRef,
    onSessionReadyRef,
    pendingCommandRef,
    pendingCommandSentRef,
    projectPath,
    queueFrame,
    resetInputQueue,
    resetVisualState,
    resizeFrameRef,
    screenRef,
    scrollTerminal,
    sendInput,
    sessionIdRef,
    sessionRef,
    setClosedState,
    setFrameState,
    socketRef,
    socketCwdRef,
    socketTitleRef,
    terminalOptionsRef,
    titleChangeRef,
    workingDirectoryChangeRef,
    triggerVisualBell,
    wheelScrollAccumulatorRef,
  });

  return {
    bellActive,
    closed,
    frame,
    handleRestoreScrollback,
    handleScrollToBottom,
    jumpedScrollbackOffset,
  };
}
