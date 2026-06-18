import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SystemFont } from "../lib/api";
import { isTauriRuntime, listSystemFonts } from "../lib/api";
import {
  type AppSettings,
  type ShortcutAction,
  defaultMonoFontFamily,
  defaultUiFontFamily,
} from "../lib/settings";
import { SettingsSections } from "./settings/SettingsSections";
import { SettingsSidebar } from "./settings/SettingsSidebar";
import {
  type SettingsSectionId,
  settingsSectionTitle,
} from "./settings/types";

interface SettingsPageProps {
  readonly settings: AppSettings;
  readonly onChange: (settings: AppSettings) => void;
  readonly onReset: () => void;
}

const fallbackFonts: readonly SystemFont[] = [
  { family: defaultUiFontFamily, monospace: false },
  { family: defaultMonoFontFamily, monospace: true },
];

export function SettingsPage({
  settings,
  onChange,
  onReset,
}: SettingsPageProps) {
  const [activeSection, setActiveSection] =
    useState<SettingsSectionId>("fonts");
  const fontsQuery = useQuery({
    queryKey: ["system-fonts"],
    queryFn: listSystemFonts,
    enabled: isTauriRuntime(),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const fonts = fontsQuery.data ?? fallbackFonts;
  const uiFonts = useMemo(
    () => withSelectedFont(fonts, settings.uiFontFamily),
    [fonts, settings.uiFontFamily],
  );
  const monoFonts = useMemo(
    () =>
      withSelectedFont(
        fonts.filter((font) => font.monospace),
        settings.monoFontFamily,
      ),
    [fonts, settings.monoFontFamily],
  );

  const updateShortcut = (action: ShortcutAction, shortcut: string) => {
    onChange({
      ...settings,
      shortcuts: {
        ...settings.shortcuts,
        [action]: shortcut,
      },
    });
  };

  return (
    <section className="settings-page" aria-label="Settings">
      <div className="settings-panel">
        <SettingsSidebar
          activeSection={activeSection}
          onReset={onReset}
          onSectionChange={setActiveSection}
        />

        <div className="settings-content">
          <header className="settings-head">
            <div>
              <h1>{settingsSectionTitle(activeSection)}</h1>
            </div>
          </header>

          <SettingsSections
            activeSection={activeSection}
            fontsLoading={fontsQuery.isLoading}
            monoFonts={monoFonts}
            settings={settings}
            uiFonts={uiFonts}
            onChange={onChange}
            onShortcutChange={updateShortcut}
          />
        </div>
      </div>
    </section>
  );
}

function withSelectedFont(
  fonts: readonly SystemFont[],
  selectedFamily: string,
): readonly SystemFont[] {
  if (fonts.some((font) => font.family === selectedFamily)) {
    return fonts;
  }

  return [{ family: selectedFamily, monospace: false }, ...fonts];
}
