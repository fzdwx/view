import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  DEFAULT_TERMINAL_MODES,
  TERMINAL_SCROLLBACK_HINT_TTL_MS,
  type TerminalClose,
  type TerminalFrame,
  type TerminalInput,
  type TerminalModes,
} from "../lib/terminalTypes";

type ScrollIntent = "up" | "down" | "bottom";

export interface TerminalVisualState {
  readonly bellActive: boolean;
  readonly closed: TerminalClose | null;
  readonly frame: TerminalFrame | null;
  readonly frameRef: RefObject<TerminalFrame | null>;
  readonly jumpedScrollbackOffset: number | null;
  readonly modesRef: RefObject<TerminalModes>;
  readonly clearScrollbackHint: () => void;
  readonly flushPendingFrame: () => void;
  readonly markPendingScrollIntent: (direction: ScrollIntent) => void;
  readonly queueFrame: (
    frame: TerminalFrame,
    screenElement: HTMLElement,
    sendInput: (data: TerminalInput | null) => void,
  ) => void;
  readonly resetVisualState: () => void;
  readonly setClosedState: (closed: TerminalClose | null) => void;
  readonly setFrameState: (frame: TerminalFrame) => void;
  readonly showScrollbackHint: (offset: number) => void;
  readonly triggerVisualBell: () => void;
}

export function useTerminalVisualState(): TerminalVisualState {
  const frameRef = useRef<TerminalFrame | null>(null);
  const pendingFrameRef = useRef<TerminalFrame | null>(null);
  const frameFlushRef = useRef<number | null>(null);
  const modesRef = useRef<TerminalModes>(DEFAULT_TERMINAL_MODES);
  const visualBellTimerRef = useRef<number | null>(null);
  const scrollbackHintTimerRef = useRef<number | null>(null);
  const pendingScrollIntentRef = useRef<{
    readonly direction: ScrollIntent;
    readonly expiresAt: number;
  } | null>(null);
  const [frame, setFrame] = useState<TerminalFrame | null>(null);
  const [closed, setClosed] = useState<TerminalClose | null>(null);
  const [jumpedScrollbackOffset, setJumpedScrollbackOffset] = useState<number | null>(null);
  const [bellActive, setBellActive] = useState(false);

  const clearScrollbackHint = useCallback(() => {
    if (scrollbackHintTimerRef.current != null) {
      window.clearTimeout(scrollbackHintTimerRef.current);
      scrollbackHintTimerRef.current = null;
    }
    setJumpedScrollbackOffset(null);
  }, []);

  const showScrollbackHint = useCallback(
    (offset: number) => {
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
    },
    [clearScrollbackHint],
  );

  const triggerVisualBell = useCallback(() => {
    if (visualBellTimerRef.current != null) {
      window.clearTimeout(visualBellTimerRef.current);
    }
    setBellActive(true);
    visualBellTimerRef.current = window.setTimeout(() => {
      visualBellTimerRef.current = null;
      setBellActive(false);
    }, 180);
  }, []);

  const consumePendingScrollIntent = useCallback((): ScrollIntent | null => {
    const pendingIntent = pendingScrollIntentRef.current;
    pendingScrollIntentRef.current = null;
    if (!pendingIntent || pendingIntent.expiresAt < performance.now()) {
      return null;
    }
    return pendingIntent.direction;
  }, []);

  const markPendingScrollIntent = useCallback((direction: ScrollIntent) => {
    pendingScrollIntentRef.current = {
      direction,
      expiresAt: performance.now() + 400,
    };
  }, []);

  const setFrameState = useCallback((nextFrame: TerminalFrame) => {
    setClosed(null);
    frameRef.current = nextFrame;
    setFrame(nextFrame);
  }, []);

  const flushPendingFrame = useCallback(() => {
    if (frameFlushRef.current != null) {
      window.cancelAnimationFrame(frameFlushRef.current);
      frameFlushRef.current = null;
    }
    const pendingFrame = pendingFrameRef.current;
    pendingFrameRef.current = null;
    if (pendingFrame) {
      setFrameState(pendingFrame);
    }
  }, [setFrameState]);

  const queueFrame = useCallback(
    (
      nextFrame: TerminalFrame,
      screenElement: HTMLElement,
      sendInput: (data: TerminalInput | null) => void,
    ) => {
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
        document.activeElement === screenElement
      ) {
        sendInput("\x1b[I");
      }
      pendingFrameRef.current = { ...nextFrame, displayOffset: nextDisplayOffset };
      if (frameFlushRef.current == null) {
        frameFlushRef.current = window.requestAnimationFrame(() => {
          frameFlushRef.current = null;
          const pendingFrame = pendingFrameRef.current;
          pendingFrameRef.current = null;
          if (pendingFrame) {
            setFrameState(pendingFrame);
          }
        });
      }
    },
    [clearScrollbackHint, consumePendingScrollIntent, setFrameState, showScrollbackHint],
  );

  const resetVisualState = useCallback(() => {
    flushPendingFrame();
    if (scrollbackHintTimerRef.current != null) {
      window.clearTimeout(scrollbackHintTimerRef.current);
      scrollbackHintTimerRef.current = null;
    }
    if (visualBellTimerRef.current != null) {
      window.clearTimeout(visualBellTimerRef.current);
      visualBellTimerRef.current = null;
    }
    setBellActive(false);
    setJumpedScrollbackOffset(null);
    frameRef.current = null;
    pendingFrameRef.current = null;
    modesRef.current = DEFAULT_TERMINAL_MODES;
  }, [flushPendingFrame]);

  return {
    bellActive,
    closed,
    frame,
    frameRef,
    jumpedScrollbackOffset,
    modesRef,
    clearScrollbackHint,
    flushPendingFrame,
    markPendingScrollIntent,
    queueFrame,
    resetVisualState,
    setClosedState: setClosed,
    setFrameState,
    showScrollbackHint,
    triggerVisualBell,
  };
}
