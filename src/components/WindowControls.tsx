import { useEffect, useState } from "react";
import { Minus, Square, X, Copy } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "../lib/api";

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void appWindow.isMaximized().then(setMaximized).catch(() => {});
    void appWindow
      .onResized(() => {
        void appWindow.isMaximized().then(setMaximized).catch(() => {});
      })
      .then((unlistenFn) => {
        unlisten = unlistenFn;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <div className="window-controls">
      <button
        type="button"
        className="window-control-button"
        aria-label="Minimize"
        title="Minimize"
        onClick={() => void getCurrentWindow().minimize()}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        className="window-control-button"
        aria-label={maximized ? "Restore" : "Maximize"}
        title={maximized ? "Restore" : "Maximize"}
        onClick={() => void getCurrentWindow().toggleMaximize()}
      >
        {maximized ? <Copy size={12} /> : <Square size={12} />}
      </button>
      <button
        type="button"
        className="window-control-button window-control-close"
        aria-label="Close"
        title="Close"
        onClick={() => void getCurrentWindow().close()}
      >
        <X size={14} />
      </button>
    </div>
  );
}
