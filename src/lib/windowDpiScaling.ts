import { isTauriRuntime } from "./api";
import {
  appZoomMax,
  appZoomMin,
  defaultAppZoom,
  loadAppSettings,
} from "./settings";

const installedWindowScaleSync = new Set<string>();
const windowScaleStateByLabel = new Map<string, WindowScaleState>();
const windowScaleSyncDelayMs = 140;
const scaleEpsilon = 0.001;
const nativeScaleFallbackThreshold = 1.05;

interface LogicalSizeLike {
  readonly width: number;
  readonly height: number;
}

interface PhysicalSizeLike {
  readonly width: number;
  readonly height: number;
}

interface PhysicalPositionLike {
  readonly x: number;
  readonly y: number;
}

interface MonitorLike {
  readonly position: PhysicalPositionLike;
  readonly size: PhysicalSizeLike;
}

interface WindowScaleState {
  physicalWidth: number | null;
  physicalHeight: number | null;
  preferredLogicalWidth: number | null;
  preferredLogicalHeight: number | null;
  displayScale: number | null;
}

interface WindowScaleSnapshot {
  readonly displayScale: number;
  readonly zoomScale: number;
  readonly usesHostDisplayScale: boolean;
  readonly physicalWidth: number;
  readonly physicalHeight: number;
  readonly logicalWidth: number | null;
  readonly logicalHeight: number | null;
  readonly maximized: boolean;
  readonly fullscreen: boolean;
  readonly minimized: boolean;
}

interface ZoomableWindow {
  readonly label: string;
  setZoom(zoom: number): Promise<void>;
  setSize(size: unknown): Promise<void>;
  innerSize(): Promise<PhysicalSizeLike>;
  scaleFactor(): Promise<number>;
  isMaximized(): Promise<boolean>;
  isFullscreen(): Promise<boolean>;
  isMinimized(): Promise<boolean>;
  onMoved(handler: (_event: unknown) => void): Promise<() => void>;
  onScaleChanged(handler: (_event: unknown) => void): Promise<() => void>;
}

/**
 * Applies the current app zoom and keeps it aligned with the display that
 * currently hosts the window.
 */
export async function applyDisplayScale(options: {
  readonly appZoom?: number;
  readonly logicalSize?: LogicalSizeLike;
} = {}): Promise<void> {
  const normalizedAppZoom = normalizeAppZoom(options.appZoom);

  if (!isTauriRuntime()) {
    applyBrowserZoom(normalizedAppZoom);
    return;
  }

  const { getCurrentWebviewWindow } = await import(
    "@tauri-apps/api/webviewWindow"
  );
  const webview = getCurrentWebviewWindow() as unknown as ZoomableWindow;
  await ensureWindowScaleSync(webview);

  const snapshot = await readWindowScaleSnapshot(webview);
  await syncWindowLogicalSize(webview, options.logicalSize, snapshot);
  await webview.setZoom(normalizedAppZoom * (snapshot?.zoomScale ?? 1));
}

async function ensureWindowScaleSync(webview: ZoomableWindow): Promise<void> {
  if (installedWindowScaleSync.has(webview.label)) {
    return;
  }

  installedWindowScaleSync.add(webview.label);
  let syncTimer: number | null = null;
  const scheduleSync = () => {
    if (syncTimer != null) {
      window.clearTimeout(syncTimer);
    }
    syncTimer = window.setTimeout(() => {
      syncTimer = null;
      void applyDisplayScale({ appZoom: loadAppSettings().appZoom });
    }, windowScaleSyncDelayMs);
  };

  try {
    await Promise.all([
      webview.onMoved(scheduleSync),
      webview.onScaleChanged(scheduleSync),
    ]);
  } catch (error) {
    if (syncTimer != null) {
      window.clearTimeout(syncTimer);
    }
    installedWindowScaleSync.delete(webview.label);
    throw error;
  }
}

async function syncWindowLogicalSize(
  webview: ZoomableWindow,
  logicalSize: LogicalSizeLike | undefined,
  snapshot: WindowScaleSnapshot | null,
): Promise<void> {
  const state = windowScaleStateByLabel.get(webview.label) ?? {
    physicalWidth: null,
    physicalHeight: null,
    preferredLogicalWidth: null,
    preferredLogicalHeight: null,
    displayScale: null,
  };

  if (logicalSize) {
    state.preferredLogicalWidth = logicalSize.width;
    state.preferredLogicalHeight = logicalSize.height;
  }

  if (!snapshot) {
    windowScaleStateByLabel.set(webview.label, state);
    if (logicalSize) {
      const size = await buildWindowSizeForLogicalSize(logicalSize, 1, false);
      await webview.setSize(size);
    }
    return;
  }

  const scaleChanged =
    state.displayScale != null &&
    Math.abs(snapshot.displayScale - state.displayScale) > scaleEpsilon;
  const shouldKeepLogicalSize =
    !snapshot.maximized && !snapshot.fullscreen && !snapshot.minimized;
  const targetLogicalWidth =
    state.preferredLogicalWidth ??
    (scaleChanged
      ? resolveLogicalSizeFromPreviousDisplay(
          state.physicalWidth,
          state.displayScale,
        )
      : null);
  const targetLogicalHeight =
    state.preferredLogicalHeight ??
    (scaleChanged
      ? resolveLogicalSizeFromPreviousDisplay(
          state.physicalHeight,
          state.displayScale,
        )
      : null);

  if (
    shouldKeepLogicalSize &&
    targetLogicalWidth != null &&
    targetLogicalHeight != null &&
    (logicalSize != null || scaleChanged) &&
    !logicalSizeMatches(
      snapshot.logicalWidth,
      snapshot.logicalHeight,
      targetLogicalWidth,
      targetLogicalHeight,
    )
  ) {
    const size = await buildWindowSizeForLogicalSize(
      {
        width: targetLogicalWidth,
        height: targetLogicalHeight,
      },
      snapshot.displayScale,
      snapshot.usesHostDisplayScale,
    );
    await webview.setSize(size);
    state.physicalWidth = Math.round(targetLogicalWidth * snapshot.displayScale);
    state.physicalHeight = Math.round(
      targetLogicalHeight * snapshot.displayScale,
    );
  } else {
    state.physicalWidth = snapshot.physicalWidth;
    state.physicalHeight = snapshot.physicalHeight;
  }

  state.displayScale = snapshot.displayScale;
  windowScaleStateByLabel.set(webview.label, state);
}

async function readWindowScaleSnapshot(
  webview: ZoomableWindow,
): Promise<WindowScaleSnapshot | null> {
  const [size, nativeScaleFactor, maximized, fullscreen, minimized] =
    await Promise.all([
      webview.innerSize(),
      webview.scaleFactor(),
      webview.isMaximized(),
      webview.isFullscreen(),
      webview.isMinimized(),
    ]);

  const sanitizedNativeScale =
    typeof nativeScaleFactor === "number" &&
    Number.isFinite(nativeScaleFactor) &&
    nativeScaleFactor > 0
      ? nativeScaleFactor
      : 1;
  const hostDisplayScale =
    sanitizedNativeScale <= nativeScaleFallbackThreshold
      ? await resolveHostDisplayScale()
      : null;
  const usesHostDisplayScale =
    hostDisplayScale != null &&
    hostDisplayScale > sanitizedNativeScale + scaleEpsilon;
  const displayScale = usesHostDisplayScale
    ? hostDisplayScale
    : sanitizedNativeScale;

  return {
    displayScale,
    zoomScale: usesHostDisplayScale ? displayScale : 1,
    usesHostDisplayScale,
    physicalWidth: size.width,
    physicalHeight: size.height,
    logicalWidth: roundLogicalSize(size.width / displayScale),
    logicalHeight: roundLogicalSize(size.height / displayScale),
    maximized,
    fullscreen,
    minimized,
  };
}

async function resolveHostDisplayScale(): Promise<number | null> {
  try {
    const [{ currentMonitor, availableMonitors }, { invoke }] = await Promise.all([
      import("@tauri-apps/api/window"),
      import("@tauri-apps/api/core"),
    ]);
    const [monitor, monitors] = await Promise.all([
      currentMonitor(),
      availableMonitors(),
    ]);
    if (!monitor) {
      return null;
    }

    const sortedMonitors = [...monitors].sort(compareMonitors);
    const monitorIndex = sortedMonitors.findIndex((candidate) =>
      isSameMonitor(candidate, monitor),
    );
    const resolvedScale = await invoke<number | null>(
      "wsl_display_scale_for_monitor",
      {
        monitorIndex: monitorIndex >= 0 ? monitorIndex : 0,
        monitorCount: sortedMonitors.length,
        monitorWidth: monitor.size.width,
        monitorHeight: monitor.size.height,
      },
    ).catch(() => null);

    return normalizeDisplayScale(resolvedScale);
  } catch {
    return null;
  }
}

function compareMonitors(left: MonitorLike, right: MonitorLike): number {
  return (
    left.position.x - right.position.x ||
    left.position.y - right.position.y ||
    left.size.width - right.size.width ||
    left.size.height - right.size.height
  );
}

function isSameMonitor(left: MonitorLike, right: MonitorLike): boolean {
  return (
    left.position.x === right.position.x &&
    left.position.y === right.position.y &&
    left.size.width === right.size.width &&
    left.size.height === right.size.height
  );
}

async function buildWindowSizeForLogicalSize(
  logicalSize: LogicalSizeLike,
  displayScale: number,
  usesHostDisplayScale: boolean,
): Promise<unknown> {
  const { LogicalSize } = await import("@tauri-apps/api/window");
  const width = usesHostDisplayScale
    ? logicalSize.width * displayScale
    : logicalSize.width;
  const height = usesHostDisplayScale
    ? logicalSize.height * displayScale
    : logicalSize.height;
  return new LogicalSize(width, height);
}

function normalizeAppZoom(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultAppZoom;
  }

  return Math.min(appZoomMax, Math.max(appZoomMin, value));
}

function normalizeDisplayScale(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 1
    ? value
    : null;
}

function resolveLogicalSizeFromPreviousDisplay(
  physicalSize: number | null,
  displayScale: number | null,
): number | null {
  if (
    physicalSize == null ||
    displayScale == null ||
    !Number.isFinite(displayScale) ||
    displayScale <= 0
  ) {
    return null;
  }

  return roundLogicalSize(physicalSize / displayScale);
}

function logicalSizeMatches(
  currentWidth: number | null,
  currentHeight: number | null,
  targetWidth: number,
  targetHeight: number,
): boolean {
  if (currentWidth == null || currentHeight == null) {
    return false;
  }

  return (
    Math.abs(currentWidth - targetWidth) < scaleEpsilon &&
    Math.abs(currentHeight - targetHeight) < scaleEpsilon
  );
}

function roundLogicalSize(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  return Math.round(value * 1000) / 1000;
}

function applyBrowserZoom(zoom: number): void {
  if (typeof document === "undefined") {
    return;
  }

  if (Math.abs(zoom - 1) < scaleEpsilon) {
    document.documentElement.style.removeProperty("zoom");
    return;
  }

  document.documentElement.style.setProperty("zoom", `${zoom}`);
}
