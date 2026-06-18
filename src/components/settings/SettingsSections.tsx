import type { SystemFont } from "../../lib/api";
import {
  type AppSettings,
  shortcutRows,
} from "../../lib/settings";
import { ShortcutRecorder, type ShortcutChangeHandler } from "./ShortcutRecorder";
import {
  EditorFontRows,
  SettingRow,
  SettingsGroup,
  UiFontRow,
} from "./SettingsRows";
import type { SettingsSectionId } from "./types";

interface SettingsSectionsProps {
  readonly activeSection: SettingsSectionId;
  readonly fontsLoading: boolean;
  readonly monoFonts: readonly SystemFont[];
  readonly settings: AppSettings;
  readonly uiFonts: readonly SystemFont[];
  readonly onChange: (settings: AppSettings) => void;
  readonly onShortcutChange: ShortcutChangeHandler;
}

export function SettingsSections({
  activeSection,
  fontsLoading,
  monoFonts,
  settings,
  uiFonts,
  onChange,
  onShortcutChange,
}: SettingsSectionsProps) {
  return (
    <div className="settings-body">
      {activeSection === "fonts" ? (
        <FontSettings
          fontsLoading={fontsLoading}
          monoFonts={monoFonts}
          settings={settings}
          uiFonts={uiFonts}
          onChange={onChange}
        />
      ) : null}
      {activeSection === "shortcuts" ? (
        <ShortcutSettings settings={settings} onChange={onShortcutChange} />
      ) : null}
    </div>
  );
}

function FontSettings({
  fontsLoading,
  monoFonts,
  settings,
  uiFonts,
  onChange,
}: {
  readonly fontsLoading: boolean;
  readonly monoFonts: readonly SystemFont[];
  readonly settings: AppSettings;
  readonly uiFonts: readonly SystemFont[];
  readonly onChange: (settings: AppSettings) => void;
}) {
  return (
    <SettingsGroup
      description="UI font controls app chrome. Code font controls editor, diff and terminal text."
      title="Application and code text"
    >
      <UiFontRow
        fonts={uiFonts}
        loading={fontsLoading}
        settings={settings}
        onChange={onChange}
      />
      <EditorFontRows
        fonts={monoFonts}
        loading={fontsLoading}
        settings={settings}
        onChange={onChange}
      />
    </SettingsGroup>
  );
}

function ShortcutSettings({
  settings,
  onChange,
}: {
  readonly settings: AppSettings;
  readonly onChange: ShortcutChangeHandler;
}) {
  return (
    <SettingsGroup title="Keyboard">
      {shortcutRows.map((row) => (
        <SettingRow
          key={row.action}
          description={row.description}
          label={row.label}
        >
          <ShortcutRecorder
            value={settings.shortcuts[row.action]}
            onChange={(shortcut) => onChange(row.action, shortcut)}
          />
        </SettingRow>
      ))}
    </SettingsGroup>
  );
}
