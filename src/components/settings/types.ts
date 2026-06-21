export type SettingsSectionId = "fonts" | "shortcuts" | "editor" | "terminal";

export function settingsSectionTitle(section: SettingsSectionId): string {
  switch (section) {
    case "fonts":
      return "Fonts";
    case "shortcuts":
      return "Keyboard Shortcuts";
    case "editor":
      return "Editor";
    case "terminal":
      return "Terminal";
  }
}
