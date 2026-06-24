export type PerfLogFields = Record<string, boolean | number | string | null | undefined>;

export interface PerfLogOptions {
  readonly slowThresholdMs?: number;
}

const perfLogStorageKey = "view:perf-log";
const slowThresholdMs = 16;

export function isPerfLogEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get("perf") === "0") {
    return false;
  }
  if (params.get("perf") === "1") {
    return true;
  }

  return window.localStorage.getItem(perfLogStorageKey) !== "0";
}

export function timeSync<T>(
  label: string,
  action: () => T,
  fields?: PerfLogFields,
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
  fields?: PerfLogFields,
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
  fields?: PerfLogFields,
  options?: PerfLogOptions,
): void {
  if (!isPerfLogEnabled()) {
    return;
  }

  const roundedMs = Math.round(durationMs * 10) / 10;
  const thresholdMs = options?.slowThresholdMs ?? slowThresholdMs;
  const method = durationMs >= thresholdMs ? "warn" : "debug";
  console[method]("[perf]", label, {
    ms: roundedMs,
    ...fields,
  });
}
