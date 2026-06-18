import type { ReactNode } from "react";
import type { SystemFont } from "../../lib/api";
import {
  type AppSettings,
  defaultMonoFontFamily,
  defaultUiFontFamily,
} from "../../lib/settings";
import { SettingsNumberInput } from "./SettingsNumberInput";
import { SettingsSelect, type SettingsSelectOption } from "./SettingsSelect";

const fontWeightOptions: readonly SettingsSelectOption[] = [
  { label: "Light", value: "300" },
  { label: "Regular", value: "400" },
  { label: "Medium", value: "500" },
  { label: "Semibold", value: "600" },
];

export function SettingsGroup({
  children,
  description,
  title,
}: {
  readonly children: ReactNode;
  readonly description?: string;
  readonly title: string;
}) {
  return (
    <section className="settings-group">
      <div className="settings-group-heading">
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
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
    <div className="settings-row">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      {children}
    </div>
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
      description="Branches, commits, panels and dialogs."
      label="UI font"
    >
      <SettingsSelect
        ariaLabel="UI font"
        fallbackLabel="System default"
        options={fontOptions(fonts, loading, defaultUiFontFamily)}
        searchable={true}
        searchPlaceholder="Search fonts"
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
    <SettingsFieldset
      description="Editor, diff and terminal text share this typography."
      title="Code text"
    >
      <SettingRow
        description="Font family."
        label="Code font"
      >
        <SettingsSelect
          ariaLabel="Code font"
          fallbackLabel="System default"
          options={fontOptions(fonts, loading, defaultMonoFontFamily)}
          searchable={true}
          searchPlaceholder="Search fonts"
          value={settings.monoFontFamily}
          onChange={(value) => onChange({ ...settings, monoFontFamily: value })}
        />
      </SettingRow>
      <div className="settings-control-stack">
        <SettingRow description="Text pixels." label="Size">
          <SettingsNumberInput
            ariaLabel="Font size"
            min={10}
            max={22}
            value={settings.fontSize}
            onChange={(value) =>
              onChange({
                ...settings,
                fontSize: value,
              })
            }
          />
        </SettingRow>
        <SettingRow description="Stroke weight." label="Weight">
          <SettingsSelect
            ariaLabel="Font weight"
            options={fontWeightOptions}
            value={settings.fontWeight}
            onChange={(value) => onChange({ ...settings, fontWeight: value })}
          />
        </SettingRow>
        <SettingRow description="Row spacing." label="Line height">
          <SettingsNumberInput
            ariaLabel="Line height"
            min={1.2}
            max={2}
            step={0.05}
            value={settings.lineHeight}
            onChange={(value) =>
              onChange({
                ...settings,
                lineHeight: value,
              })
            }
          />
        </SettingRow>
      </div>
      <pre className="settings-font-preview">
        git diff -- src/App.tsx{"\n"}const branch = "origin/main";
      </pre>
    </SettingsFieldset>
  );
}

function SettingsFieldset({
  children,
  description,
  title,
}: {
  readonly children: ReactNode;
  readonly description: string;
  readonly title: string;
}) {
  return (
    <section className="settings-fieldset">
      <div className="settings-fieldset-heading">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {children}
    </section>
  );
}

function fontOptions(
  fonts: readonly SystemFont[],
  loading: boolean,
  defaultValue: string,
): readonly SettingsSelectOption[] {
  const options: SettingsSelectOption[] = [
    { label: "System default", value: defaultValue },
  ];
  if (loading) {
    options.push({
      disabled: true,
      label: "Loading local fonts...",
      value: `${defaultValue}:loading`,
    });
  }
  for (const font of fonts) {
    if (font.family !== defaultValue) {
      options.push({
        label: font.family,
        value: font.family,
      });
    }
  }
  return options;
}
