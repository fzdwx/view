import { type CSSProperties, useCallback, useMemo, useState } from "react";
import { notifySettingsChanged } from "../lib/settingsEvents";
import {
  appFontCss,
  defaultAppSettings,
  loadAppSettings,
  monoFontCss,
  saveAppSettings,
  type AppSettings,
} from "../lib/settings";
import { SettingsPage } from "./SettingsPage";
import { WindowControls } from "./WindowControls";

type SettingsWindowStyle = CSSProperties & {
  readonly "--app-font-family": string;
  readonly "--mono": string;
  readonly "--editor-font-size": string;
  readonly "--editor-font-weight": string;
  readonly "--editor-line-height": string;
};

export function SettingsWindowApp() {
  const [settings, setSettings] = useState(loadAppSettings);
  const style = useMemo<SettingsWindowStyle>(
    () => ({
      "--app-font-family": appFontCss(settings),
      "--mono": monoFontCss(settings),
      "--editor-font-size": `${settings.fontSize}px`,
      "--editor-font-weight": settings.fontWeight,
      "--editor-line-height": `${Math.round(settings.fontSize * settings.lineHeight)}px`,
    }),
    [settings],
  );

  const updateSettings = useCallback((nextSettings: AppSettings) => {
    setSettings(nextSettings);
    saveAppSettings(nextSettings);
    notifySettingsChanged();
  }, []);
  const resetSettings = useCallback(() => {
    updateSettings(defaultAppSettings);
  }, [updateSettings]);

  return (
    <main className="settings-window-shell" style={style}>
      <div className="settings-title-bar" data-tauri-drag-region>
        <span className="settings-title-label" data-tauri-drag-region>
          Settings
        </span>
        <WindowControls />
      </div>
      <SettingsPage
        settings={settings}
        onChange={updateSettings}
        onReset={resetSettings}
      />
    </main>
  );
}
