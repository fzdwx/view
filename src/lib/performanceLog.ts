export type PerfLogFields = Record<string, boolean | number | string | null | undefined>;
type PerfLogFieldSource = PerfLogFields | (() => PerfLogFields);

export interface PerfLogOptions {
  readonly slowThresholdMs?: number;
}

const perfLogStorageKey = "view:perf-log";
const slowThresholdMs = 16;
const panelResizeEndEvent = "view:panel-resize-end";
const deferredLogLimit = 80;

interface DeferredPerfLogEntry {
  readonly label: string;
  readonly durationMs: number;
  readonly fields?: PerfLogFieldSource;
  readonly thresholdMs: number;
}

let deferredResizeLogs: DeferredPerfLogEntry[] = [];
let deferredResizeLogOverflow = 0;
let resizeLogFlushAttached = false;
let cachedPerfLogEnabled: boolean | null = null;

export function isPerfLogEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (cachedPerfLogEnabled != null) {
    return cachedPerfLogEnabled;
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get("perf") === "0") {
    cachedPerfLogEnabled = false;
    return cachedPerfLogEnabled;
  }
  if (params.get("perf") === "1") {
    cachedPerfLogEnabled = true;
    return cachedPerfLogEnabled;
  }

  cachedPerfLogEnabled = window.localStorage.getItem(perfLogStorageKey) !== "0";
  return cachedPerfLogEnabled;
}

export function timeSync<T>(
  label: string,
  action: () => T,
  fields?: PerfLogFieldSource,
  options?: PerfLogOptions,
): T {
  if (!isPerfLogEnabled()) {
    return action();
  }

  const startedAt = performance.now();
  try {
    return action();
  } finally {
    logPerf(label, performance.now() - startedAt, fields, options);
  }
}

export async function timeAsync<T>(
  label: string,
  action: () => Promise<T>,
  fields?: PerfLogFieldSource,
  options?: PerfLogOptions,
): Promise<T> {
  if (!isPerfLogEnabled()) {
    return action();
  }

  const startedAt = performance.now();
  try {
    return await action();
  } finally {
    logPerf(label, performance.now() - startedAt, fields, options);
  }
}

export function logPerf(
  label: string,
  durationMs: number,
  fields?: PerfLogFieldSource,
  options?: PerfLogOptions,
): void {
  if (!isPerfLogEnabled()) {
    return;
  }

  const thresholdMs = options?.slowThresholdMs ?? slowThresholdMs;
  if (isPanelResizeInProgress()) {
    deferResizePerfLog({ label, durationMs, fields, thresholdMs });
    return;
  }

  writePerfLog(label, durationMs, fields, thresholdMs);
}

function writePerfLog(
  label: string,
  durationMs: number,
  fields: PerfLogFieldSource | undefined,
  thresholdMs: number,
): void {
  const roundedMs = Math.round(durationMs * 10) / 10;
  const method = durationMs >= thresholdMs ? "warn" : "debug";
  const resolvedFields = resolvePerfFields(fields);
  console[method]("[perf]", label, {
    ms: roundedMs,
    ...resolvedFields,
  });
}

function deferResizePerfLog(entry: DeferredPerfLogEntry): void {
  if (deferredResizeLogs.length < deferredLogLimit) {
    deferredResizeLogs.push(entry);
  } else {
    deferredResizeLogOverflow += 1;
  }

  if (resizeLogFlushAttached || typeof window === "undefined") {
    return;
  }

  resizeLogFlushAttached = true;
  window.addEventListener(panelResizeEndEvent, flushDeferredResizeLogs, {
    once: true,
  });
}

function flushDeferredResizeLogs(): void {
  resizeLogFlushAttached = false;
  const logs = deferredResizeLogs;
  const overflow = deferredResizeLogOverflow;
  deferredResizeLogs = [];
  deferredResizeLogOverflow = 0;

  scheduleDeferredResizeLogFlush(() => {
    for (const log of logs) {
      writePerfLog(
        `deferred:${log.label}`,
        log.durationMs,
        () => ({
          ...resolvePerfFields(log.fields),
          deferredDuringResize: true,
        }),
        log.thresholdMs,
      );
    }
    if (overflow > 0) {
      writePerfLog(
        "deferred:overflow",
        0,
        { skipped: overflow, reason: "panel-resize-log-limit" },
        slowThresholdMs,
      );
    }
  });
}

function scheduleDeferredResizeLogFlush(callback: () => void): void {
  const runWhenIdle = () => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(callback, { timeout: 1_000 });
      return;
    }

    window.setTimeout(callback, 180);
  };

  window.requestAnimationFrame(() => {
    window.setTimeout(runWhenIdle, 180);
  });
}

function resolvePerfFields(fields: PerfLogFieldSource | undefined): PerfLogFields | undefined {
  return typeof fields === "function" ? fields() : fields;
}

function isPanelResizeInProgress(): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  return (
    document.body.classList.contains("is-resizing-x") ||
    document.body.classList.contains("is-resizing-y")
  );
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === perfLogStorageKey) {
      cachedPerfLogEnabled = null;
    }
  });
}
