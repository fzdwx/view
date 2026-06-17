import { isTauriRuntime } from "./api";
import { settingsChangedEvent, settingsStorageKey } from "./settings";

type SettingsChangeListener = () => void;
type Unlisten = () => void;

export function notifySettingsChanged(): void {
  window.dispatchEvent(new Event(settingsChangedEvent));
  if (!isTauriRuntime()) {
    return;
  }

  void emitTauriSettingsChanged().catch(reportSettingsEventError);
}

export function subscribeToSettingsChanges(
  listener: SettingsChangeListener,
): Unlisten {
  let disposed = false;
  let unlistenTauri: Unlisten | null = null;

  if (isTauriRuntime()) {
    void listenTauriSettingsChanged(listener, (unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }

      unlistenTauri = unlisten;
    }).catch(reportSettingsEventError);
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === settingsStorageKey) {
      listener();
    }
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(settingsChangedEvent, listener);

  return () => {
    disposed = true;
    if (unlistenTauri) {
      unlistenTauri();
    }
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(settingsChangedEvent, listener);
  };
}

async function emitTauriSettingsChanged(): Promise<void> {
  const { emit } = await import("@tauri-apps/api/event");
  await emit(settingsChangedEvent);
}

async function listenTauriSettingsChanged(
  listener: SettingsChangeListener,
  onReady: (unlisten: Unlisten) => void,
): Promise<void> {
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen(settingsChangedEvent, () => listener());
  onReady(unlisten);
}

function reportSettingsEventError(error: unknown): void {
  if (error instanceof Error) {
    console.error("Settings event bridge failed:", error.message);
    return;
  }

  console.error("Settings event bridge failed:", String(error));
}
