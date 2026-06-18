import {
  PhysicalPosition,
  PhysicalSize,
  availableMonitors,
  getCurrentWindow,
  type Monitor,
  type Window as TauriWindow,
} from "@tauri-apps/api/window";
import { isTauriRuntime } from "./api";
import { resolveDisplayScale } from "./windowDpiScaling";

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
  readonly width: number;
  readonly height: number;
  readonly maximized: boolean;
  readonly scale: number | null;
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

  // When the Windows DPI scale changes between sessions (e.g. 100% -> 150%
  // under WSLg), the previously saved physical size is stale. Compensate by
  // the ratio of the current scale to the scale captured at save time so the
  // restored window matches the new display density. When the scale is
  // unchanged the factor is 1.0 and behavior is preserved exactly.
  const currentScale = (await resolveDisplayScale()) ?? 1;
  const savedScale = savedState.scale ?? 1;
  const scaleFactor = savedScale > 0 ? currentScale / savedScale : 1;

  await appWindow.setSize(
    new PhysicalSize(
      Math.round(savedState.width * scaleFactor),
      Math.round(savedState.height * scaleFactor),
    ),
  );
  await appWindow.setPosition(
    new PhysicalPosition(
      Math.round(savedState.x * scaleFactor),
      Math.round(savedState.y * scaleFactor),
    ),
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
    const [size, position, maximized, fullscreen, minimized] =
      await Promise.all([
        appWindow.innerSize(),
        appWindow.outerPosition(),
        appWindow.isMaximized(),
        appWindow.isFullscreen(),
        appWindow.isMinimized(),
      ]);

    if (fullscreen || minimized) {
      return;
    }

    const scale = (await resolveDisplayScale()) ?? null;
    saveWindowState({
      x: Math.round(position.x),
      y: Math.round(position.y),
      width: Math.round(size.width),
      height: Math.round(size.height),
      maximized,
      scale,
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

  const { x, y, width, height, maximized, scale } = value;
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(width) ||
    !isFiniteNumber(height) ||
    width < minimumWindowWidth ||
    height < minimumWindowHeight
  ) {
    return null;
  }

  return {
    x,
    y,
    width,
    height,
    maximized: typeof maximized === "boolean" ? maximized : false,
    scale: typeof scale === "number" && scale > 0 ? scale : null,
  };
}

function windowStateIntersectsVisibleWorkArea(
  state: SavedWindowState,
  monitors: readonly Monitor[],
): boolean {
  const stateRight = state.x + state.width;
  const stateBottom = state.y + state.height;

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
