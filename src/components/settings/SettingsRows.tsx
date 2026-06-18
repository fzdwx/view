import type { ReactNode } from "react";
import type { SystemFont } from "../../lib/api";
import {
  type AppSettings,
  defaultMonoFontFamily,
  defaultUiFontFamily,
} from "../../lib/settings";
import { SettingsSegmented, type SegmentedOption } from "./SettingsSegmented";
import { SettingsSelect, type SettingsSelectOption } from "./SettingsSelect";
import { SettingsSlider } from "./SettingsSlider";

const fontWeightOptions: readonly SegmentedOption[] = [
  { label: "Light", value: "300" },
  { label: "Regular", value: "400" },
  { label: "Medium", value: "500" },
  { label: "Semibold", value: "600" },
];

const fontSizeMin = 10;
const fontSizeMax = 22;
const lineHeightMin = 1.2;
const lineHeightMax = 2;
const lineHeightStep = 0.05;

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

export function UiFontCard({
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
    <section className="font-card">
      <header className="font-card-heading">
        <h3>UI font</h3>
        <p>Branches, commits, panels and dialogs.</p>
      </header>
      <SettingsSelect
        ariaLabel="UI font"
        fallbackLabel="System default"
        menuSize="large"
        options={fontOptions(fonts, loading, defaultUiFontFamily)}
        searchable={true}
        searchPlaceholder="Search fonts"
        value={settings.uiFontFamily}
        onChange={(value) => onChange({ ...settings, uiFontFamily: value })}
      />
      <pre className="font-preview font-preview-ui">
        {`main  feature/settings-redesign
  feat: rework fonts page
  fix:  restore staged file
› ○ Unstaged changes (3)`}
      </pre>
    </section>
  );
}

export function CodeFontCard({
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
    <section className="font-card">
      <header className="font-card-heading">
        <h3>Code font</h3>
        <p>Editor, diff and terminal text.</p>
      </header>
      <SettingsSelect
        ariaLabel="Code font"
        fallbackLabel="System default"
        menuSize="large"
        options={fontOptions(fonts, loading, defaultMonoFontFamily)}
        searchable={true}
        searchPlaceholder="Search fonts"
        value={settings.monoFontFamily}
        onChange={(value) => onChange({ ...settings, monoFontFamily: value })}
      />
      <div className="font-controls">
        <div className="font-control">
          <div className="font-control-label">
            <span>Size</span>
            <output className="font-control-value">{settings.fontSize}px</output>
          </div>
          <SettingsSlider
            ariaLabel="Code font size"
            max={fontSizeMax}
            min={fontSizeMin}
            value={settings.fontSize}
            onChange={(value) => onChange({ ...settings, fontSize: value })}
          />
        </div>
        <div className="font-control">
          <div className="font-control-label">
            <span>Weight</span>
          </div>
          <SettingsSegmented
            ariaLabel="Code font weight"
            options={fontWeightOptions}
            value={settings.fontWeight}
            onChange={(value) => onChange({ ...settings, fontWeight: value })}
          />
        </div>
        <div className="font-control">
          <div className="font-control-label">
            <span>Line height</span>
            <output className="font-control-value">
              {settings.lineHeight.toFixed(2)}
            </output>
          </div>
          <SettingsSlider
            ariaLabel="Code line height"
            max={lineHeightMax}
            min={lineHeightMin}
            step={lineHeightStep}
            value={settings.lineHeight}
            onChange={(value) => onChange({ ...settings, lineHeight: value })}
          />
        </div>
      </div>
      <pre className="font-preview font-preview-code">
        {`// src/lib/settings.ts
export const lineHeight = 1.56;

fn render(diff: &Diff) -> Result<()> {
    println!("Hello, 世界!");
    Ok(())
}

+import { useState } from "react";`}
      </pre>
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
