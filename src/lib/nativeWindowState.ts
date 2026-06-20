import {
  LogicalSize,
  PhysicalPosition,
  PhysicalSize,
  availableMonitors,
  getCurrentWindow,
  type Monitor,
  type Window as TauriWindow,
} from "@tauri-apps/api/window";
import { isTauriRuntime } from "./api";

const mainWindowStateStorageKey = "view.main-window-state.v1";
const windowStatePersistenceMark = "view:window-state-persistence";
const ignoredWindowLabels = new Set(["settings"]);
const saveDelayMs = 180;
const minimumWindowWidth = 980;
const minimumWindowHeight = 640;
const minimumVisiblePixels = 96;

interface SavedWindowState {
  readonly x: number;
  readonly y: number;
  readonly physicalWidth: number;
  readonly physicalHeight: number;
  readonly logicalWidth: number | null;
  readonly logicalHeight: number | null;
  readonly maximized: boolean;
}

let windowStatePersistenceInstalled = false;

export function installMainWindowStatePersistence(): void {
  if (windowStatePersistenceInstalled || !isTauriRuntime()) {
    return;
  }

  windowStatePersistenceInstalled = true;
  void installMainWindowStatePersistenceForTauri();
}

async function installMainWindowStatePersistenceForTauri(): Promise<void> {
  try {
    const appWindow = getCurrentWindow();
    if (ignoredWindowLabels.has(appWindow.label)) {
      return;
    }

    await restoreWindowState(appWindow);
    registerWindowStateListeners(appWindow);
    performance.mark(windowStatePersistenceMark);
  } catch (error) {
    reportNativeWindowStateError("install", error);
  }
}

async function restoreWindowState(appWindow: TauriWindow): Promise<void> {
  const savedState = loadSavedWindowState();
  if (!savedState) {
    return;
  }

  const monitors = await availableMonitors();
  if (
    monitors.length > 0 &&
    !windowStateIntersectsVisibleWorkArea(savedState, monitors)
  ) {
    return;
  }

  await appWindow.setPosition(
    new PhysicalPosition(
      Math.round(savedState.x),
      Math.round(savedState.y),
    ),
  );

  await appWindow.setSize(
    resolveRestoredWindowSize(savedState, monitors),
  );
  if (savedState.maximized) {
    await appWindow.maximize();
  }
}

function registerWindowStateListeners(appWindow: TauriWindow): void {
  const saveLater = createDebouncedWindowStateSaver(appWindow);
  void appWindow
    .onResized(() => saveLater())
    .catch((error: unknown) => reportNativeWindowStateError("resize", error));
  void appWindow
    .onMoved(() => saveLater())
    .catch((error: unknown) => reportNativeWindowStateError("move", error));
  void appWindow
    .onScaleChanged(() => saveLater())
    .catch((error: unknown) => reportNativeWindowStateError("scale", error));
  window.addEventListener("pagehide", () => {
    void persistCurrentWindowState(appWindow);
  });
}

function createDebouncedWindowStateSaver(
  appWindow: TauriWindow,
): () => void {
  let saveTimer: number | null = null;

  return () => {
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
    }

    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      void persistCurrentWindowState(appWindow);
    }, saveDelayMs);
  };
}

async function persistCurrentWindowState(
  appWindow: TauriWindow,
): Promise<void> {
  try {
    const [size, position, maximized, fullscreen, minimized, scaleFactor] =
      await Promise.all([
        appWindow.innerSize(),
        appWindow.outerPosition(),
        appWindow.isMaximized(),
        appWindow.isFullscreen(),
        appWindow.isMinimized(),
        appWindow.scaleFactor(),
      ]);

    if (fullscreen || minimized) {
      return;
    }

    const safeScaleFactor =
      Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;

    saveWindowState({
      x: Math.round(position.x),
      y: Math.round(position.y),
      physicalWidth: Math.round(size.width),
      physicalHeight: Math.round(size.height),
      logicalWidth: roundLogicalSize(size.width / safeScaleFactor),
      logicalHeight: roundLogicalSize(size.height / safeScaleFactor),
      maximized,
    });
  } catch (error) {
    reportNativeWindowStateError("save", error);
  }
}

function loadSavedWindowState(): SavedWindowState | null {
  try {
    const raw = localStorage.getItem(mainWindowStateStorageKey);
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    return normalizeSavedWindowState(parsed);
  } catch (error) {
    reportNativeWindowStateError("load", error);
    return null;
  }
}

function saveWindowState(state: SavedWindowState): void {
  try {
    localStorage.setItem(mainWindowStateStorageKey, JSON.stringify(state));
  } catch (error) {
    reportNativeWindowStateError("persist", error);
  }
}

function normalizeSavedWindowState(value: unknown): SavedWindowState | null {
  if (!isRecord(value)) {
    return null;
  }

  const { x, y, physicalWidth, physicalHeight, logicalWidth, logicalHeight, width, height, maximized } = value;
  const normalizedPhysicalWidth = isFiniteNumber(physicalWidth)
    ? physicalWidth
    : isFiniteNumber(width)
      ? width
      : NaN;
  const normalizedPhysicalHeight = isFiniteNumber(physicalHeight)
    ? physicalHeight
    : isFiniteNumber(height)
      ? height
      : NaN;
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !Number.isFinite(normalizedPhysicalWidth) ||
    !Number.isFinite(normalizedPhysicalHeight) ||
    normalizedPhysicalWidth < minimumWindowWidth ||
    normalizedPhysicalHeight < minimumWindowHeight
  ) {
    return null;
  }

  return {
    x,
    y,
    physicalWidth: normalizedPhysicalWidth,
    physicalHeight: normalizedPhysicalHeight,
    logicalWidth: isFiniteNumber(logicalWidth) ? logicalWidth : null,
    logicalHeight: isFiniteNumber(logicalHeight) ? logicalHeight : null,
    maximized: typeof maximized === "boolean" ? maximized : false,
  };
}

function windowStateIntersectsVisibleWorkArea(
  state: SavedWindowState,
  monitors: readonly Monitor[],
): boolean {
  const stateRight = state.x + state.physicalWidth;
  const stateBottom = state.y + state.physicalHeight;

  return monitors.some((monitor) => {
    const workArea = monitor.workArea;
    const workAreaRight = workArea.position.x + workArea.size.width;
    const workAreaBottom = workArea.position.y + workArea.size.height;
    const visibleWidth =
      Math.min(stateRight, workAreaRight) -
      Math.max(state.x, workArea.position.x);
    const visibleHeight =
      Math.min(stateBottom, workAreaBottom) -
      Math.max(state.y, workArea.position.y);

    return (
      visibleWidth >= minimumVisiblePixels &&
      visibleHeight >= minimumVisiblePixels
    );
  });
}

function resolveRestoredWindowSize(
  state: SavedWindowState,
  monitors: readonly Monitor[],
): LogicalSize | PhysicalSize {
  const targetScaleFactor = resolveSavedWindowScaleFactor(state, monitors);
  if (
    targetScaleFactor != null &&
    state.logicalWidth != null &&
    state.logicalHeight != null
  ) {
    return new PhysicalSize(
      Math.round(state.logicalWidth * targetScaleFactor),
      Math.round(state.logicalHeight * targetScaleFactor),
    );
  }

  if (state.logicalWidth != null && state.logicalHeight != null) {
    return new LogicalSize(state.logicalWidth, state.logicalHeight);
  }

  return new PhysicalSize(
    Math.round(state.physicalWidth),
    Math.round(state.physicalHeight),
  );
}

function resolveSavedWindowScaleFactor(
  state: SavedWindowState,
  monitors: readonly Monitor[],
): number | null {
  const pointMatchedMonitor = monitors.find((monitor) =>
    monitorContainsPoint(monitor, state.x, state.y),
  );
  if (pointMatchedMonitor) {
    return sanitizeMonitorScaleFactor(pointMatchedMonitor.scaleFactor);
  }

  const intersectedMonitor = resolveBestIntersectedMonitor(state, monitors);
  return intersectedMonitor
    ? sanitizeMonitorScaleFactor(intersectedMonitor.scaleFactor)
    : null;
}

function resolveBestIntersectedMonitor(
  state: SavedWindowState,
  monitors: readonly Monitor[],
): Monitor | null {
  const stateRight = state.x + state.physicalWidth;
  const stateBottom = state.y + state.physicalHeight;
  let bestMonitor: Monitor | null = null;
  let bestArea = 0;

  for (const monitor of monitors) {
    const monitorRight = monitor.position.x + monitor.size.width;
    const monitorBottom = monitor.position.y + monitor.size.height;
    const visibleWidth =
      Math.min(stateRight, monitorRight) - Math.max(state.x, monitor.position.x);
    const visibleHeight =
      Math.min(stateBottom, monitorBottom) -
      Math.max(state.y, monitor.position.y);
    const visibleArea = Math.max(0, visibleWidth) * Math.max(0, visibleHeight);
    if (visibleArea > bestArea) {
      bestArea = visibleArea;
      bestMonitor = monitor;
    }
  }

  return bestMonitor;
}

function monitorContainsPoint(
  monitor: Monitor,
  x: number,
  y: number,
): boolean {
  const right = monitor.position.x + monitor.size.width;
  const bottom = monitor.position.y + monitor.size.height;
  return x >= monitor.position.x && x < right && y >= monitor.position.y && y < bottom;
}

function sanitizeMonitorScaleFactor(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function roundLogicalSize(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.round(value * 1000) / 1000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function reportNativeWindowStateError(action: string, error: unknown): void {
  if (error instanceof Error) {
    console.warn(`Failed to ${action} native window state: ${error.message}`);
    return;
  }

  console.warn(`Failed to ${action} native window state: ${String(error)}`);
}
