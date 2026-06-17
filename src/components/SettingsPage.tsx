import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
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
  settingsSectionDescription,
  settingsSectionTitle,
} from "./settings/types";

interface SettingsPageProps {
  readonly settings: AppSettings;
  readonly onChange: (settings: AppSettings) => void;
  readonly onClose: () => void;
  readonly onReset: () => void;
}

const fallbackFonts: readonly SystemFont[] = [
  { family: defaultUiFontFamily, monospace: false },
  { family: defaultMonoFontFamily, monospace: true },
];

export function SettingsPage({
  settings,
  onChange,
  onClose,
  onReset,
}: SettingsPageProps) {
  const [activeSection, setActiveSection] =
    useState<SettingsSectionId>("common");
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
              <p>{settingsSectionDescription(activeSection)}</p>
            </div>
            <button
              type="button"
              className="icon-button settings-close-button"
              aria-label="Close settings"
              onClick={onClose}
            >
              <X size={14} />
            </button>
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
