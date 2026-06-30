export interface TerminalResizeSize {
  readonly cols: number;
  readonly rows: number;
}

interface PendingTerminalResize {
  readonly sessionId: string;
  readonly size: TerminalResizeSize;
}

export interface TerminalResizeSchedulerOptions {
  readonly addPanelResizeEndListener: (listener: () => void) => void;
  readonly clearTimeout: (id: number) => void;
  readonly currentSessionId: () => string | null;
  readonly isPanelResizeInProgress: () => boolean;
  readonly normalDebounceMs: number;
  readonly removePanelResizeEndListener: (listener: () => void) => void;
  readonly sendResize: (
    sessionId: string,
    size: TerminalResizeSize,
  ) => Promise<void>;
  readonly setTimeout: (callback: () => void, delayMs: number) => number;
}

export interface TerminalResizeScheduler {
  readonly dispose: () => void;
  readonly flush: () => void;
  readonly queue: (sessionId: string, size: TerminalResizeSize) => void;
}

export function createTerminalResizeScheduler({
  addPanelResizeEndListener,
  clearTimeout,
  currentSessionId,
  isPanelResizeInProgress,
  normalDebounceMs,
  removePanelResizeEndListener,
  sendResize,
  setTimeout,
}: TerminalResizeSchedulerOptions): TerminalResizeScheduler {
  let disposed = false;
  let resizeTimer: number | null = null;
  let resizeInFlight = false;
  let panelResizeEndListening = false;
  let pendingResize: PendingTerminalResize | null = null;

  const clearResizeTimer = () => {
    if (resizeTimer == null) {
      return;
    }
    clearTimeout(resizeTimer);
    resizeTimer = null;
  };

  const removePanelResizeEnd = () => {
    if (!panelResizeEndListening) {
      return;
    }
    removePanelResizeEndListener(flushAfterPanelResize);
    panelResizeEndListening = false;
  };

  const schedulePanelResizeEndFlush = () => {
    clearResizeTimer();
    if (panelResizeEndListening) {
      return;
    }
    panelResizeEndListening = true;
    addPanelResizeEndListener(flushAfterPanelResize);
  };

  const flushPending = () => {
    if (disposed || resizeInFlight) {
      return;
    }
    if (isPanelResizeInProgress()) {
      schedulePanelResizeEndFlush();
      return;
    }

    const nextResize = pendingResize;
    if (!nextResize) {
      return;
    }
    pendingResize = null;
    resizeInFlight = true;

    void sendResize(
      currentSessionId() ?? nextResize.sessionId,
      nextResize.size,
    )
      .catch(() => undefined)
      .finally(() => {
        resizeInFlight = false;
        if (disposed) {
          pendingResize = null;
          return;
        }
        if (!pendingResize) {
          return;
        }
        if (isPanelResizeInProgress()) {
          schedulePanelResizeEndFlush();
          return;
        }
        flushPending();
      });
  };

  function flushAfterPanelResize() {
    removePanelResizeEnd();
    flushPending();
  }

  const scheduleDebouncedFlush = () => {
    clearResizeTimer();
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      flushPending();
    }, normalDebounceMs);
  };

  return {
    dispose: () => {
      disposed = true;
      clearResizeTimer();
      removePanelResizeEnd();
      pendingResize = null;
    },
    flush: () => {
      clearResizeTimer();
      removePanelResizeEnd();
      flushPending();
    },
    queue: (sessionId, size) => {
      if (disposed) {
        return;
      }
      pendingResize = { sessionId, size };
      if (isPanelResizeInProgress()) {
        schedulePanelResizeEndFlush();
        return;
      }
      scheduleDebouncedFlush();
    },
  };
}
