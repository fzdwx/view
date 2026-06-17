import type { ReactNode } from "react";
import type { SystemFont } from "../../lib/api";
import {
  type AppSettings,
  defaultMonoFontFamily,
  defaultUiFontFamily,
} from "../../lib/settings";

export function SettingsGroup({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) {
  return (
    <section className="settings-group">
      <h2>{title}</h2>
      <div className="settings-group-body">{children}</div>
    </section>
  );
}

export function SettingRow({
  children,
  description,
  label,
}: {
  readonly children: ReactNode;
  readonly description: string;
  readonly label: string;
}) {
  return (
    <label className="settings-row">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      {children}
    </label>
  );
}

export function UiFontRow({
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
    <SettingRow
      description="Controls the font used by branches, commits, panels and dialogs."
      label="Application: Font Family"
    >
      <FontSelect
        defaultValue={defaultUiFontFamily}
        fonts={fonts}
        loading={loading}
        value={settings.uiFontFamily}
        onChange={(value) => onChange({ ...settings, uiFontFamily: value })}
      />
    </SettingRow>
  );
}

export function EditorFontRows({
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
    <>
      <SettingRow
        description="Controls the font used by file editing, diffs and terminal text."
        label="Editor: Font Family"
      >
        <FontSelect
          defaultValue={defaultMonoFontFamily}
          fonts={fonts}
          loading={loading}
          value={settings.monoFontFamily}
          onChange={(value) => onChange({ ...settings, monoFontFamily: value })}
        />
      </SettingRow>
      <div className="settings-inline-grid">
        <SettingRow description="Font size in pixels." label="Editor: Font Size">
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
        </SettingRow>
        <SettingRow description="Text weight for code surfaces." label="Editor: Font Weight">
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
        </SettingRow>
        <SettingRow description="Line rhythm for editor rows." label="Editor: Line Height">
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
        </SettingRow>
      </div>
      <pre className="settings-font-preview">
        git diff -- src/App.tsx{"\n"}const branch = "origin/main";
      </pre>
    </>
  );
}

function FontSelect({
  defaultValue,
  fonts,
  loading,
  value,
  onChange,
}: {
  readonly defaultValue: string;
  readonly fonts: readonly SystemFont[];
  readonly loading: boolean;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {fontOptions(fonts, loading, defaultValue)}
    </select>
  );
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
