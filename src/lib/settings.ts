export type ShortcutAction =
  | "commandPanel"
  | "saveFile"
  | "pullCurrentBranch"
  | "openGitLog"
  | "openTerminal"
  | "switchProject"
  | "closeTab"
  | "nextTab"
  | "prevTab"
  | "jumpToDiffFile"
  | "findFiles"
  | "findInFiles";

export interface AppSettings {
  uiFontFamily: string;
  monoFontFamily: string;
  fontSize: number;
  fontWeight: string;
  lineHeight: number;
  appZoom: number;
  shortcuts: Record<ShortcutAction, string>;
  useCodeMirrorEditor: boolean;
}

export interface ShortcutRow {
  readonly action: ShortcutAction;
  readonly label: string;
  readonly description: string;
}

export const settingsStorageKey = "view.settings.v1";
export const settingsChangedEvent = "view://settings-changed";

export const defaultUiFontFamily =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

export const defaultMonoFontFamily =
  '"SFMono-Regular", "Cascadia Mono", "Cascadia Code", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", monospace';

export const appZoomMin = 0.75;
export const appZoomMax = 2;
export const appZoomStep = 0.05;
export const defaultAppZoom = 1;

export const defaultAppSettings: AppSettings = {
  uiFontFamily: defaultUiFontFamily,
  monoFontFamily: defaultMonoFontFamily,
  fontSize: 12,
  fontWeight: "400",
  lineHeight: 1.56,
  appZoom: defaultAppZoom,
  shortcuts: {
    commandPanel: "Mod+P",
    saveFile: "Mod+S",
    pullCurrentBranch: "Mod+T",
    openGitLog: "Mod+G",
    openTerminal: "Mod+`",
    switchProject: "Mod+O",
    closeTab: "Mod+W",
    nextTab: "Mod+Shift+]",
    prevTab: "Mod+Shift+[",
    jumpToDiffFile: "F4",
    findFiles: "Mod+Shift+O",
    findInFiles: "Mod+Shift+F",
  },
  useCodeMirrorEditor: true,
};

export const shortcutRows: readonly ShortcutRow[] = [
  {
    action: "commandPanel",
    label: "Command panel",
    description: "Search files and commands",
  },
  {
    action: "saveFile",
    label: "Save file",
    description: "Save the active editor tab",
  },
  {
    action: "pullCurrentBranch",
    label: "Pull branch",
    description: "Choose merge or rebase",
  },
  {
    action: "openGitLog",
    label: "Open Git log",
    description: "Focus the Git panel",
  },
  {
    action: "openTerminal",
    label: "Open terminal",
    description: "Focus the terminal panel",
  },
  {
    action: "switchProject",
    label: "Switch project",
    description: "Open the project switcher",
  },
  {
    action: "closeTab",
    label: "Close tab",
    description: "Close the active editor tab",
  },
  {
    action: "nextTab",
    label: "Next tab",
    description: "Switch to the next editor tab",
  },
  {
    action: "prevTab",
    label: "Previous tab",
    description: "Switch to the previous editor tab",
  },
  {
    action: "jumpToDiffFile",
    label: "Jump to file",
    description: "Open the file from a diff view",
  },
  {
    action: "findFiles",
    label: "Find files",
    description: "Search file names by fuzzy match",
  },
  {
    action: "findInFiles",
    label: "Find in files",
    description: "Search file contents",
  },
];

export function loadAppSettings(): AppSettings {
  if (typeof localStorage === "undefined") {
    return defaultAppSettings;
  }

  try {
    const raw = localStorage.getItem(settingsStorageKey);
    if (!raw) {
      return defaultAppSettings;
    }

    return normalizeAppSettings(JSON.parse(raw));
  } catch {
    return defaultAppSettings;
  }
}

export function saveAppSettings(settings: AppSettings): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
}

export function appFontCss(settings: AppSettings): string {
  return normalizeFontCss(settings.uiFontFamily, defaultUiFontFamily);
}

export function monoFontCss(settings: AppSettings): string {
  return normalizeFontCss(settings.monoFontFamily, defaultMonoFontFamily);
}

function normalizeAppSettings(value: unknown): AppSettings {
  const record = isRecord(value) ? value : {};
  const shortcuts = isRecord(record.shortcuts) ? record.shortcuts : {};
  const legacyFontFamily = normalizeFontValue(record.fontFamily);

  return {
    uiFontFamily:
      normalizeFontValue(record.uiFontFamily) ?? defaultAppSettings.uiFontFamily,
    monoFontFamily:
      normalizeFontValue(record.monoFontFamily) ??
      legacyFontFamily ??
      defaultAppSettings.monoFontFamily,
    fontSize: normalizeNumber(record.fontSize, defaultAppSettings.fontSize, 10, 22),
    fontWeight:
      normalizeFontWeight(record.fontWeight) ?? defaultAppSettings.fontWeight,
    lineHeight: normalizeNumber(
      record.lineHeight,
      defaultAppSettings.lineHeight,
      1.2,
      2,
    ),
    appZoom: normalizeNumber(
      record.appZoom,
      defaultAppSettings.appZoom,
      appZoomMin,
      appZoomMax,
    ),
    shortcuts: shortcutRows.reduce<Record<ShortcutAction, string>>((current, row) => {
      const shortcut = shortcuts[row.action];
      const trimmedShortcut = typeof shortcut === "string" ? shortcut.trim() : "";
      return {
        ...current,
        [row.action]: trimmedShortcut
          ? trimmedShortcut
          : defaultAppSettings.shortcuts[row.action],
      };
    }, { ...defaultAppSettings.shortcuts }),
    useCodeMirrorEditor:
      typeof record.useCodeMirrorEditor === "boolean"
        ? record.useCodeMirrorEditor
        : defaultAppSettings.useCodeMirrorEditor,
  };
}

function normalizeFontCss(value: string, fallback: string): string {
  const normalized = normalizeFontValue(value);
  if (!normalized) {
    return fallback;
  }

  return normalized.includes(",")
    ? normalized
    : `${quoteCssFontFamily(normalized)}, ${fallback}`;
}

function quoteCssFontFamily(value: string): string {
  const escaped = value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return `"${escaped}"`;
}

function normalizeFontValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeFontWeight(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return ["300", "400", "500", "600"].includes(value) ? value : null;
}

function normalizeNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
