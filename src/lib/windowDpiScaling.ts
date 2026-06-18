import { isTauriRuntime } from "./api";

/**
 * Returns the Windows DPI scale factor when running under WSL with WSLg,
 * otherwise null.
 *
 * Under WSLg the Weston compositor reports wl_output.scale = 1 even for
 * HiDPI displays, so the scale must be read from the Windows registry and
 * applied to the webview zoom from the frontend. Applying zoom from Rust
 * before navigation is reset by WebKitGTK, so this must run after the
 * webview content has loaded.
 *
 * Tauri APIs are imported dynamically to preserve the existing lazy-loading
 * boundaries (e.g. settingsWindow.ts keeps @tauri-apps/api/webviewWindow out
 * of the main chunk until it is actually needed).
 */
export async function resolveDisplayScale(): Promise<number | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const scale = await invoke<number | null>("wsl_display_scale").catch(
    () => null,
  );
  if (!scale || scale <= 1) {
    return null;
  }
  return scale;
}

/**
 * Applies the resolved display scale to the current window's webview zoom,
 * and scales its logical size when `logicalSize` is provided. Zoom is applied
 * from the frontend (post-navigation) because Rust-side zoom is reset by
 * WebKitGTK on page load.
 */
export async function applyDisplayScale(options: {
  readonly logicalSize?: { readonly width: number; readonly height: number };
} = {}): Promise<void> {
  const scale = await resolveDisplayScale();
  if (!scale) {
    return;
  }
  const { getCurrentWebviewWindow } = await import(
    "@tauri-apps/api/webviewWindow"
  );
  const webview = getCurrentWebviewWindow();
  await webview.setZoom(scale);
  if (options.logicalSize) {
    const { LogicalSize } = await import("@tauri-apps/api/window");
    await webview.setSize(
      new LogicalSize(
        options.logicalSize.width * scale,
        options.logicalSize.height * scale,
      ),
    );
  }
}
