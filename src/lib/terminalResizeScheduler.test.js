import { describe, expect, test } from "bun:test";
import { createTerminalResizeScheduler } from "./terminalResizeScheduler";

function createHarness() {
  let panelResizing = false;
  let nextTimerId = 1;
  const timers = new Map();
  const panelResizeEndListeners = new Set();
  const sent = [];
  const scheduler = createTerminalResizeScheduler({
    clearTimeout: (id) => {
      timers.delete(id);
    },
    currentSessionId: () => "session-current",
    isPanelResizeInProgress: () => panelResizing,
    normalDebounceMs: 120,
    addPanelResizeEndListener: (listener) => {
      panelResizeEndListeners.add(listener);
    },
    removePanelResizeEndListener: (listener) => {
      panelResizeEndListeners.delete(listener);
    },
    sendResize: async (sessionId, size) => {
      sent.push({ sessionId, size });
    },
    setTimeout: (callback) => {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, callback);
      return id;
    },
  });

  return {
    emitPanelResizeEnd: () => {
      for (const listener of [...panelResizeEndListeners]) {
        listener();
      }
    },
    runTimers: () => {
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
    },
    scheduler,
    sent,
    setPanelResizing: (value) => {
      panelResizing = value;
    },
    timerCount: () => timers.size,
  };
}

describe("createTerminalResizeScheduler", () => {
  test("defers terminal resize while a panel resize is active", () => {
    const harness = createHarness();
    harness.setPanelResizing(true);

    harness.scheduler.queue("session-a", { cols: 80, rows: 24 });
    harness.scheduler.queue("session-a", { cols: 120, rows: 31 });
    harness.runTimers();

    expect(harness.sent).toEqual([]);

    harness.setPanelResizing(false);
    harness.emitPanelResizeEnd();

    expect(harness.sent).toEqual([
      {
        sessionId: "session-current",
        size: { cols: 120, rows: 31 },
      },
    ]);
  });

  test("debounces normal terminal resize to the latest size", () => {
    const harness = createHarness();

    harness.scheduler.queue("session-a", { cols: 80, rows: 24 });
    harness.scheduler.queue("session-a", { cols: 90, rows: 25 });

    expect(harness.sent).toEqual([]);
    expect(harness.timerCount()).toBe(1);

    harness.runTimers();

    expect(harness.sent).toEqual([
      {
        sessionId: "session-current",
        size: { cols: 90, rows: 25 },
      },
    ]);
  });
});
