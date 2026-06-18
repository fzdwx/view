import { type CSSProperties, useEffect, useMemo, useState } from "react";
import {
  type AppSettings,
  appFontCss,
  loadAppSettings,
  monoFontCss,
  saveAppSettings,
} from "../lib/settings";
import { subscribeToSettingsChanges } from "../lib/settingsEvents";

interface AppShellStyle extends CSSProperties {
  readonly "--app-font-family": string;
  readonly "--mono": string;
  readonly "--editor-font-size": string;
  readonly "--editor-font-weight": string;
  readonly "--editor-line-height": string;
}

export interface AppSettingsState {
  readonly appSettings: AppSettings;
  readonly appShellStyle: AppShellStyle;
}

export function useAppSettingsState(): AppSettingsState {
  const [appSettings, setAppSettings] = useState(loadAppSettings);

  useEffect(() => {
    saveAppSettings(appSettings);
  }, [appSettings]);

  useEffect(
    () =>
      subscribeToSettingsChanges(() => {
        setAppSettings(loadAppSettings());
      }),
    [],
  );

  const appShellStyle = useMemo<AppShellStyle>(
    () => ({
      gridTemplateColumns: "48px minmax(0, 1fr)",
      "--app-font-family": appFontCss(appSettings),
      "--mono": monoFontCss(appSettings),
      "--editor-font-size": `${appSettings.fontSize}px`,
      "--editor-font-weight": appSettings.fontWeight,
      "--editor-line-height": `${Math.round(
        appSettings.fontSize * appSettings.lineHeight,
      )}px`,
    }),
    [appSettings],
  );

  return {
    appSettings,
    appShellStyle,
  };
}
