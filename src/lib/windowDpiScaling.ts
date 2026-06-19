import { isTauriRuntime } from "./api";
import {
  appZoomMax,
  appZoomMin,
  defaultAppZoom,
} from "./settings";

/**
 * Applies the current app zoom to the active window and optionally forces
 * a logical size for windows that need a fixed default footprint.
 */
export async function applyDisplayScale(options: {
  readonly appZoom?: number;
  readonly logicalSize?: { readonly width: number; readonly height: number };
} = {}): Promise<void> {
  const normalizedAppZoom = normalizeAppZoom(options.appZoom);

  if (!isTauriRuntime()) {
    applyBrowserZoom(normalizedAppZoom);
    return;
  }

  const { getCurrentWebviewWindow } = await import(
    "@tauri-apps/api/webviewWindow"
  );
  const webview = getCurrentWebviewWindow();
  await webview.setZoom(normalizedAppZoom);
  if (options.logicalSize) {
    const { LogicalSize } = await import("@tauri-apps/api/window");
    await webview.setSize(
      new LogicalSize(
        options.logicalSize.width,
        options.logicalSize.height,
      ),
    );
  }
}

function normalizeAppZoom(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultAppZoom;
  }

  return Math.min(appZoomMax, Math.max(appZoomMin, value));
}

function applyBrowserZoom(zoom: number): void {
  if (typeof document === "undefined") {
    return;
  }

  if (Math.abs(zoom - 1) < 0.001) {
    document.documentElement.style.removeProperty("zoom");
    return;
  }

  document.documentElement.style.setProperty("zoom", `${zoom}`);
}
