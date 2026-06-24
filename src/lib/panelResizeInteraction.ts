export const panelResizeStartEvent = "view:panel-resize-start";
export const panelResizeEndEvent = "view:panel-resize-end";

export function dispatchPanelResizeStart(): void {
  window.dispatchEvent(new CustomEvent(panelResizeStartEvent));
}

export function dispatchPanelResizeEnd(): void {
  window.dispatchEvent(new CustomEvent(panelResizeEndEvent));
}

export function isPanelResizeInProgress(): boolean {
  return (
    document.body.classList.contains("is-resizing-x") ||
    document.body.classList.contains("is-resizing-y")
  );
}

export interface PanelResizeIdleTaskHandle {
  readonly cancel: () => void;
}

export interface PanelResizeIdleTaskOptions {
  readonly delayMs?: number;
  readonly idleTimeoutMs?: number;
  readonly timeoutMs?: number;
}

export function runAfterPanelResizeIdle(
  task: () => void,
  options: PanelResizeIdleTaskOptions = {},
): PanelResizeIdleTaskHandle {
  if (typeof window === "undefined") {
    task();
    return { cancel: () => undefined };
  }

  let canceled = false;
  let delayId: number | null = null;
  let timeoutId: number | null = null;
  let idleId: number | null = null;

  const cleanup = () => {
    if (delayId != null) {
      window.clearTimeout(delayId);
      delayId = null;
    }
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (
      idleId != null &&
      typeof window.cancelIdleCallback === "function"
    ) {
      window.cancelIdleCallback(idleId);
      idleId = null;
    }
    window.removeEventListener(panelResizeEndEvent, schedule);
  };

  const run = () => {
    cleanup();
    if (!canceled && isPanelResizeInProgress()) {
      window.addEventListener(panelResizeEndEvent, schedule, { once: true });
      return;
    }
    if (!canceled) {
      task();
    }
  };

  function schedule() {
    cleanup();
    if (canceled) {
      return;
    }

    const delayMs = options.delayMs ?? 0;
    if (delayMs > 0) {
      delayId = window.setTimeout(() => {
        delayId = null;
        scheduleIdleTask();
      }, delayMs);
      return;
    }

    scheduleIdleTask();
  }

  function scheduleIdleTask() {
    if (canceled) {
      return;
    }

    const scheduleIdle = window.requestIdleCallback;
    if (typeof scheduleIdle === "function") {
      idleId = scheduleIdle(run, {
        timeout: options.idleTimeoutMs ?? 500,
      });
      return;
    }

    timeoutId = window.setTimeout(run, options.timeoutMs ?? 0);
  }

  if (isPanelResizeInProgress()) {
    window.addEventListener(panelResizeEndEvent, schedule, { once: true });
  } else {
    schedule();
  }

  return {
    cancel: () => {
      canceled = true;
      cleanup();
    },
  };
}
