import { type KeyboardEvent as ReactKeyboardEvent, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Keyboard,
  MonitorCog,
  RotateCcw,
  SlidersHorizontal,
  Type,
  X,
} from "lucide-react";
import type { SystemFont } from "../lib/api";
import { isTauriRuntime, listSystemFonts } from "../lib/api";
import {
  type AppSettings,
  type ShortcutAction,
  defaultMonoFontFamily,
  defaultUiFontFamily,
  shortcutRows,
} from "../lib/settings";

type SettingsSectionId = "appearance" | "editor" | "shortcuts";

interface SettingsPageProps {
  readonly settings: AppSettings;
  readonly onChange: (settings: AppSettings) => void;
  readonly onClose: () => void;
  readonly onReset: () => void;
}

const settingsSections: ReadonlyArray<{
  readonly id: SettingsSectionId;
  readonly label: string;
  readonly description: string;
  readonly icon: typeof Type;
}> = [
  {
    id: "appearance",
    label: "Appearance",
    description: "Chrome font and native surface",
    icon: MonitorCog,
  },
  {
    id: "editor",
    label: "Editor & terminal",
    description: "Code font, size and rhythm",
    icon: Type,
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    description: "Keyboard muscle memory",
    icon: Keyboard,
  },
];

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
    useState<SettingsSectionId>("appearance");
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
        <aside className="settings-sidebar" aria-label="Settings sections">
          <div className="settings-title">
            <span>Settings</span>
            <small>Native desktop preferences</small>
          </div>
          <nav className="settings-nav">
            {settingsSections.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  type="button"
                  className={
                    activeSection === section.id
                      ? "settings-nav-item active"
                      : "settings-nav-item"
                  }
                  onClick={() => setActiveSection(section.id)}
                >
                  <Icon size={14} />
                  <span>
                    {section.label}
                    <small>{section.description}</small>
                  </span>
                </button>
              );
            })}
          </nav>
          <button
            type="button"
            className="ghost-button settings-reset"
            onClick={onReset}
          >
            <RotateCcw size={13} />
            Reset
          </button>
        </aside>

        <div className="settings-content">
          <header className="settings-head">
            <div>
              <span>{sectionTitle(activeSection)}</span>
              <small>{sectionDescription(activeSection)}</small>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Close settings"
              onClick={onClose}
            >
              <X size={14} />
            </button>
          </header>

          <div className="settings-body">
            {activeSection === "appearance" ? (
              <AppearanceSettings
                fonts={uiFonts}
                loading={fontsQuery.isLoading}
                settings={settings}
                onChange={onChange}
              />
            ) : null}
            {activeSection === "editor" ? (
              <EditorSettings
                fonts={monoFonts}
                loading={fontsQuery.isLoading}
                settings={settings}
                onChange={onChange}
              />
            ) : null}
            {activeSection === "shortcuts" ? (
              <ShortcutSettings settings={settings} onChange={updateShortcut} />
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function AppearanceSettings({
  fonts,
  loading,
  settings,
  onChange,
}: {
  readonly fonts: readonly SystemFont[];
  readonly loading: boolean;
  readonly settings: AppSettings;
  readonly onChange: (settings: AppSettings) => void;
}) {
  return (
    <section className="settings-section">
      <div className="settings-section-title">
        <SlidersHorizontal size={14} />
        <span>Application chrome</span>
      </div>
      <label className="settings-field wide">
        <span>
          UI font
          <small>Loaded from fonts installed on this machine</small>
        </span>
        <select
          value={settings.uiFontFamily}
          onChange={(event) =>
            onChange({ ...settings, uiFontFamily: event.target.value })
          }
        >
          {fontOptions(fonts, loading, defaultUiFontFamily)}
        </select>
      </label>
      <div className="settings-font-preview ui-font-preview">
        Branches, commits, panels and dialogs use this face.
      </div>
    </section>
  );
}

function EditorSettings({
  fonts,
  loading,
  settings,
  onChange,
}: {
  readonly fonts: readonly SystemFont[];
  readonly loading: boolean;
  readonly settings: AppSettings;
  readonly onChange: (settings: AppSettings) => void;
}) {
  return (
    <section className="settings-section">
      <div className="settings-section-title">
        <Type size={14} />
        <span>Code surfaces</span>
      </div>
      <label className="settings-field wide">
        <span>
          Editor and terminal font
          <small>Monospace local fonts are listed first</small>
        </span>
        <select
          value={settings.monoFontFamily}
          onChange={(event) =>
            onChange({ ...settings, monoFontFamily: event.target.value })
          }
        >
          {fontOptions(fonts, loading, defaultMonoFontFamily)}
        </select>
      </label>
      <div className="settings-grid">
        <label className="settings-field">
          <span>Size</span>
          <input
            type="number"
            min={10}
            max={22}
            value={settings.fontSize}
            onChange={(event) =>
              onChange({
                ...settings,
                fontSize: clamp(Number(event.target.value), 10, 22),
              })
            }
          />
        </label>
        <label className="settings-field">
          <span>Weight</span>
          <select
            value={settings.fontWeight}
            onChange={(event) =>
              onChange({ ...settings, fontWeight: event.target.value })
            }
          >
            <option value="300">Light</option>
            <option value="400">Regular</option>
            <option value="500">Medium</option>
            <option value="600">Semibold</option>
          </select>
        </label>
        <label className="settings-field">
          <span>Line height</span>
          <input
            type="number"
            min={1.2}
            max={2}
            step={0.05}
            value={settings.lineHeight}
            onChange={(event) =>
              onChange({
                ...settings,
                lineHeight: clamp(Number(event.target.value), 1.2, 2),
              })
            }
          />
        </label>
      </div>
      <pre className="settings-font-preview code-font-preview">
        git diff -- src/App.tsx{"\n"}
        const branch = "origin/main";
      </pre>
    </section>
  );
}

function ShortcutSettings({
  settings,
  onChange,
}: {
  readonly settings: AppSettings;
  readonly onChange: (action: ShortcutAction, shortcut: string) => void;
}) {
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null);

  return (
    <section className="settings-section">
      <div className="settings-section-title">
        <Keyboard size={14} />
        <span>Keyboard shortcuts</span>
      </div>
      <div className="shortcut-list">
        {shortcutRows.map((row) => (
          <div key={row.action} className="shortcut-row">
            <span>
              {row.label}
              <small>{row.description}</small>
            </span>
            <ShortcutRecorder
              recording={recordingAction === row.action}
              value={settings.shortcuts[row.action]}
              onCancel={() => setRecordingAction(null)}
              onChange={(shortcut) => {
                onChange(row.action, shortcut);
                setRecordingAction(null);
              }}
              onStart={() => setRecordingAction(row.action)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function ShortcutRecorder({
  recording,
  value,
  onCancel,
  onChange,
  onStart,
}: {
  readonly recording: boolean;
  readonly value: string;
  readonly onCancel: () => void;
  readonly onChange: (shortcut: string) => void;
  readonly onStart: () => void;
}) {
  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!recording) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      onCancel();
      return;
    }
    if (isModifierKey(event.key)) {
      return;
    }

    const shortcut = formatRecordedShortcut(event);
    if (shortcut) {
      onChange(shortcut);
    }
  }

  return (
    <button
      type="button"
      className={recording ? "shortcut-recorder recording" : "shortcut-recorder"}
      aria-label={recording ? "Recording shortcut" : `Record shortcut ${value}`}
      onBlur={() => {
        if (recording) {
          onCancel();
        }
      }}
      onClick={recording ? onCancel : onStart}
      onKeyDown={handleKeyDown}
    >
      {recording ? "Press keys..." : value}
    </button>
  );
}

function formatRecordedShortcut(
  event: ReactKeyboardEvent<HTMLButtonElement>,
): string | null {
  const key = shortcutKeyLabel(event);
  if (!key) {
    return null;
  }

  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) {
    parts.push("Mod");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }
  parts.push(key);
  return parts.join("+");
}

function shortcutKeyLabel(event: ReactKeyboardEvent<HTMLButtonElement>): string | null {
  if (event.key === " ") {
    return "Space";
  }
  if (event.code === "Backquote" && event.key !== "~") {
    return "`";
  }
  if (event.key.length === 1) {
    return event.key.toUpperCase();
  }

  const aliases: Record<string, string> = {
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    ArrowUp: "ArrowUp",
    Backspace: "Backspace",
    Delete: "Delete",
    End: "End",
    Enter: "Enter",
    Escape: "Escape",
    Home: "Home",
    PageDown: "PageDown",
    PageUp: "PageUp",
    Tab: "Tab",
  };
  return aliases[event.key] ?? null;
}

function isModifierKey(key: string): boolean {
  return key === "Alt" || key === "Control" || key === "Meta" || key === "Shift";
}

function fontOptions(
  fonts: readonly SystemFont[],
  loading: boolean,
  defaultValue: string,
) {
  return (
    <>
      <option value={defaultValue}>System default</option>
      {loading ? (
        <option value={defaultValue} disabled>
          Loading local fonts...
        </option>
      ) : null}
      {fonts
        .filter((font) => font.family !== defaultValue)
        .map((font) => (
          <option key={`${font.family}-${font.monospace}`} value={font.family}>
            {font.family}
          </option>
        ))}
    </>
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

function sectionTitle(section: SettingsSectionId): string {
  switch (section) {
    case "appearance":
      return "Appearance";
    case "editor":
      return "Editor & terminal";
    case "shortcuts":
      return "Shortcuts";
  }
}

function sectionDescription(section: SettingsSectionId): string {
  switch (section) {
    case "appearance":
      return "Use system-local fonts for app chrome.";
    case "editor":
      return "Tune code rendering without affecting the rest of the app.";
    case "shortcuts":
      return "Keep Git, terminal and project switching fast from the keyboard.";
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
