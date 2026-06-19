export type SettingsSectionId = "fonts" | "shortcuts" | "editor";

export function settingsSectionTitle(section: SettingsSectionId): string {
  switch (section) {
    case "fonts":
      return "Fonts";
    case "shortcuts":
      return "Keyboard Shortcuts";
    case "editor":
      return "Editor";
  }
}
