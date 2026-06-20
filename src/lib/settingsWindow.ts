import { isTauriRuntime } from "./api";
import { applyDisplayScale } from "./windowDpiScaling";

const settingsWindowLabel = "settings";
const settingsWindowUrl = "/?window=settings";
const windowBackgroundColor = "#000000";
const settingsWindowWidth = 860;
const settingsWindowHeight = 620;

let preloadPromise: Promise<void> | null = null;

export async function installSettingsWindowZoom(
  appZoom: number,
): Promise<void> {
  try {
    await applyDisplayScale({
      appZoom,
      logicalSize: {
        width: settingsWindowWidth,
        height: settingsWindowHeight,
      },
    });
  } catch {
    // ignore zoom failures
  }
}

export async function preloadSettingsWindow(): Promise<void> {
  if (!isTauriRuntime() || preloadPromise) {
    return;
  }

  preloadPromise = createHiddenSettingsWindow();
  try {
    await preloadPromise;
  } catch {
    preloadPromise = null;
  }
}

async function createHiddenSettingsWindow(): Promise<void> {
  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const existing = await WebviewWindow.getByLabel(settingsWindowLabel);
    if (existing) {
      return;
    }

    const settingsWindow = new WebviewWindow(settingsWindowLabel, {
      url: settingsWindowUrl,
      title: "",
      width: settingsWindowWidth,
      height: settingsWindowHeight,
      minWidth: 720,
      minHeight: 480,
      center: true,
      decorations: false,
      backgroundColor: windowBackgroundColor,
      allowLinkPreview: false,
      focus: false,
      resizable: true,
      visible: false,
    });

    void settingsWindow.once("tauri://error", (event: unknown) => {
      console.error("Settings window preload failed:", String(event));
      preloadPromise = null;
    });
  } catch (error) {
    preloadPromise = null;
    if (error instanceof Error) {
      console.error("Settings window preload error:", error.message);
    }
  }
}

export async function openSettingsWindow(): Promise<void> {
  if (!isTauriRuntime()) {
    const opened = window.open(
      "/settings",
      "view-settings",
      "popup,width=860,height=620",
    );
    if (!opened) {
      window.location.assign("/settings");
    }
    return;
  }

  try {
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const existing = await WebviewWindow.getByLabel(settingsWindowLabel);

    if (existing) {
      // Order matters for the same window (unminimize -> show -> focus), so these
      // run sequentially rather than Promise.all.
      // oxlint-disable-next-line react-doctor/async-parallel
      await existing.unminimize();
      // oxlint-disable-next-line react-doctor/async-parallel
      await existing.show();
      // oxlint-disable-next-line react-doctor/async-parallel
      await existing.setFocus();
      return;
    }

    if (preloadPromise) {
      try {
        await preloadPromise;
      } catch {
        preloadPromise = null;
      }
    }

    const window = await WebviewWindow.getByLabel(settingsWindowLabel);
    if (window) {
      await window.show();
      await window.setFocus();
      return;
    }

    const settingsWindow = new WebviewWindow(settingsWindowLabel, {
      url: settingsWindowUrl,
      title: "",
      width: settingsWindowWidth,
      height: settingsWindowHeight,
      minWidth: 720,
      minHeight: 480,
      center: true,
      decorations: false,
      backgroundColor: windowBackgroundColor,
      allowLinkPreview: false,
      focus: true,
      resizable: true,
      visible: true,
    });

    void settingsWindow.once("tauri://created", () => {
      void settingsWindow.setBackgroundColor(windowBackgroundColor);
      void settingsWindow.setFocus();
    });
    void settingsWindow.once<unknown>("tauri://error", (event) => {
      console.error("Failed to open settings window:", String(event.payload));
    });
  } catch (error) {
    if (error instanceof Error) {
      console.error("Failed to open settings window:", error.message);
      return;
    }

    console.error("Failed to open settings window:", String(error));
  }
}
