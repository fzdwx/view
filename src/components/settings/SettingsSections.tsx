import { useMemo } from "react";
import type { SystemFont } from "../../lib/api";
import {
  type AppSettings,
  appZoomMax,
  appZoomMin,
  appZoomStep,
  type ShortcutAction,
  type ShortcutRow,
  shortcutRows,
} from "../../lib/settings";
import { ShortcutRecorder, type ShortcutChangeHandler } from "./ShortcutRecorder";
import { SettingsSlider } from "./SettingsSlider";
import {
  CodeFontCard,
  UiFontCard,
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
      {activeSection === "editor" ? (
        <EditorSettings settings={settings} onChange={onChange} />
      ) : null}
    </div>
  );
}

function EditorSettings({
  settings,
  onChange,
}: {
  readonly settings: AppSettings;
  readonly onChange: (settings: AppSettings) => void;
}) {
  return (
    <div className="font-cards">
      <section className="font-card">
        <header className="font-card-heading">
          <h3>Application scale</h3>
          <p>
            Adjust the current app zoom while keeping it aligned with your
            system display scaling.
          </p>
        </header>
        <div className="font-control">
          <div className="font-control-label">
            <span>Scale</span>
            <output className="font-control-value">
              {Math.round(settings.appZoom * 100)}%
            </output>
          </div>
          <SettingsSlider
            ariaLabel="Application scale"
            max={appZoomMax}
            min={appZoomMin}
            step={appZoomStep}
            value={settings.appZoom}
            onChange={(value) => onChange({ ...settings, appZoom: value })}
          />
        </div>
      </section>
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
    <div className="font-cards">
      <UiFontCard
        fonts={uiFonts}
        loading={fontsLoading}
        settings={settings}
        onChange={onChange}
      />
      <CodeFontCard
        fonts={monoFonts}
        loading={fontsLoading}
        settings={settings}
        onChange={onChange}
      />
    </div>
  );
}

const shortcutGroups: readonly { readonly title: string; readonly actions: readonly ShortcutAction[] }[] = [
  { title: "Navigation", actions: ["commandPanel", "switchProject"] },
  { title: "File & editor", actions: ["saveFile", "closeTab", "nextTab", "prevTab", "jumpToDiffFile"] },
  { title: "Git", actions: ["pullCurrentBranch", "openGitLog", "openTerminal"] },
  { title: "Search", actions: ["findFiles", "findInFiles"] },
];

function ShortcutSettings({
  settings,
  onChange,
}: {
  readonly settings: AppSettings;
  readonly onChange: ShortcutChangeHandler;
}) {
  const { conflictMap, conflictCount } = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of shortcutRows) {
      const shortcut = settings.shortcuts[row.action];
      if (!shortcut) continue;
      counts[shortcut] = (counts[shortcut] ?? 0) + 1;
    }
    const conflicts: Record<string, boolean> = {};
    let conflictCount = 0;
    for (const row of shortcutRows) {
      const shortcut = settings.shortcuts[row.action];
      const conflicted = Boolean(shortcut) && (counts[shortcut] ?? 0) > 1;
      conflicts[row.action] = conflicted;
      if (conflicted) {
        conflictCount += 1;
      }
    }
    return { conflictMap: conflicts, conflictCount };
  }, [settings.shortcuts]);

  const rowsByAction = useMemo(() => {
    const map: Record<string, ShortcutRow> = {};
    for (const row of shortcutRows) {
      map[row.action] = row;
    }
    return map;
  }, []);

  return (
    <div className="shortcut-groups">
      {conflictCount > 0 ? (
        <p className="shortcut-conflict-banner">
          {conflictCount} shortcut{conflictCount > 1 ? "s" : ""} conflict with another action.
        </p>
      ) : null}
      {shortcutGroups.map((group) => (
        <section className="font-card shortcut-card" key={group.title}>
          <header className="font-card-heading">
            <h3>{group.title}</h3>
          </header>
          <div className="shortcut-rows">
            {group.actions.map((action) => {
              const row = rowsByAction[action];
              if (!row) {
                return null;
              }
              return (
                <div className="shortcut-row" key={action}>
                  <span className="shortcut-row-label">
                    <strong>{row.label}</strong>
                    <small>{row.description}</small>
                  </span>
                  <ShortcutRecorder
                    value={settings.shortcuts[action]}
                    conflict={conflictMap[action] ?? false}
                    onChange={(shortcut) => onChange(action, shortcut)}
                  />
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
