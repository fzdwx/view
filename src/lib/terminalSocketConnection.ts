import { parseTerminalSocketMessage } from "./terminalSocketMessage";
import type {
  TerminalClose,
  TerminalFrame,
  TerminalInput,
} from "./terminalTypes";

type MutableRef<T> = {
  current: T;
};

export interface TerminalSocketConnectionOptions {
  readonly activeRef: MutableRef<boolean>;
  readonly flushInput: () => void;
  readonly flushPendingFrame: () => void;
  readonly onClosedRef: MutableRef<(exitCode: number | null) => void>;
  readonly onPendingCommandSentRef: MutableRef<() => void>;
  readonly pendingCommandRef: MutableRef<string | null>;
  readonly pendingCommandSentRef: MutableRef<boolean>;
  readonly queueFrame: (
    frame: TerminalFrame,
    element: HTMLElement,
    sendInput: (data: TerminalInput | null) => void,
  ) => void;
  readonly sendInput: (data: TerminalInput | null) => void;
  readonly setClosedState: (closed: TerminalClose | null) => void;
  readonly socketRef: MutableRef<WebSocket | null>;
  readonly titleChangeRef: MutableRef<(title: string | null) => void>;
  readonly workingDirectoryChangeRef: MutableRef<(cwd: string | null) => void>;
  readonly triggerVisualBell: () => void;
}

export function connectTerminalSocket(
  wsUrl: string,
  element: HTMLElement,
  resize: () => void,
  isDisposed: { readonly current: boolean },
  options: TerminalSocketConnectionOptions,
): void {
  const socket = new WebSocket(wsUrl);
  options.socketRef.current = socket;
  socket.onopen = () => {
    if (isDisposed.current || options.socketRef.current !== socket) {
      return;
    }
    resize();
    if (options.activeRef.current) {
      element.focus({ preventScroll: true });
    }
    const command = options.pendingCommandRef.current;
    if (command && !options.pendingCommandSentRef.current) {
      options.pendingCommandSentRef.current = true;
      options.sendInput(`${command}\n`);
      options.onPendingCommandSentRef.current();
    }
    options.flushInput();
  };
  socket.onmessage = (event) => {
    if (isDisposed.current || options.socketRef.current !== socket || typeof event.data !== "string") {
      return;
    }
    const message = parseTerminalSocketMessage(event.data);
    if (!message) {
      return;
    }
    if (message.type === "frame") {
      options.titleChangeRef.current(message.title ?? null);
      options.workingDirectoryChangeRef.current(message.cwd ?? null);
      options.queueFrame(message, element, options.sendInput);
    } else if (message.type === "bell") {
      options.triggerVisualBell();
    } else {
      options.flushPendingFrame();
      options.setClosedState(message);
      options.onClosedRef.current(message.exitCode);
    }
  };
  socket.onclose = () => {
    if (!isDisposed.current && options.socketRef.current === socket) {
      options.socketRef.current = null;
    }
  };
}

export function closeTerminalSocket(
  socketRef: MutableRef<WebSocket | null>,
): void {
  const socket = socketRef.current;
  socketRef.current = null;
  if (!socket) {
    return;
  }
  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;
  socket.close();
}
