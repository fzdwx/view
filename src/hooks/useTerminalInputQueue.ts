import { useCallback, useRef } from "react";
import type { RefObject } from "react";
import { terminalInputByteLength } from "../lib/terminalInput";
import {
  MAX_PENDING_INPUT_BYTES,
  MAX_SOCKET_BUFFERED_INPUT_BYTES,
  type TerminalInput,
} from "../lib/terminalTypes";

export interface TerminalInputQueue {
  readonly flushInput: () => void;
  readonly resetInputQueue: () => void;
  readonly sendInput: (data: TerminalInput | null) => void;
}

export function useTerminalInputQueue(
  socketRef: RefObject<WebSocket | null>,
): TerminalInputQueue {
  const pendingInputRef = useRef<TerminalInput[]>([]);
  const pendingInputBytesRef = useRef(0);
  const inputFlushTimerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (inputFlushTimerRef.current != null) {
      window.clearTimeout(inputFlushTimerRef.current);
      inputFlushTimerRef.current = null;
    }
  }, []);

  const flushInput = useCallback(() => {
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
    } catch (error) {
      const retryable = error instanceof DOMException || error instanceof Error;
      if (!retryable) {
        console.warn("Terminal input send failed with non-Error rejection", error);
      }
      pendingInputRef.current.unshift(data);
      pendingInputBytesRef.current += terminalInputByteLength(data);
      inputFlushTimerRef.current = window.setTimeout(flushInput, 1);
    }
  }, [socketRef]);

  const sendInput = useCallback(
    (data: TerminalInput | null) => {
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
        } catch (error) {
          const retryable = error instanceof DOMException || error instanceof Error;
          if (!retryable) {
            console.warn("Terminal input send failed with non-Error rejection", error);
          }
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
    },
    [flushInput, socketRef],
  );

  const resetInputQueue = useCallback(() => {
    clearTimer();
    pendingInputRef.current = [];
    pendingInputBytesRef.current = 0;
  }, [clearTimer]);

  return { flushInput, resetInputQueue, sendInput };
}
