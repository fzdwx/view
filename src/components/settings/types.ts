export type SettingsSectionId = "common" | "appearance" | "editor" | "shortcuts";

export function settingsSectionTitle(section: SettingsSectionId): string {
  switch (section) {
    case "common":
      return "Commonly Used";
    case "appearance":
      return "Workbench Appearance";
    case "editor":
      return "Text Editor Font";
    case "shortcuts":
      return "Keyboard Shortcuts";
  }
}

export function settingsSectionDescription(section: SettingsSectionId): string {
  switch (section) {
    case "common":
      return "The settings you are most likely to adjust while working.";
    case "appearance":
      return "App chrome font and native window surface.";
    case "editor":
      return "Editor and terminal typography in one place.";
    case "shortcuts":
      return "Record shortcuts for the main desktop actions.";
  }
}
