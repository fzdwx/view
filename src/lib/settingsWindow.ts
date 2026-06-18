import { isTauriRuntime } from "./api";

const settingsWindowLabel = "settings";
const settingsWindowUrl = "/?window=settings";
const windowBackgroundColor = "#000000";

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
      await existing.unminimize();
      await existing.show();
      await existing.setFocus();
      return;
    }

    const settingsWindow = new WebviewWindow(settingsWindowLabel, {
      url: settingsWindowUrl,
      title: "",
      width: 860,
      height: 620,
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
