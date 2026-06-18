import { themeToTreeStyles } from "@pierre/trees";
import type { FileTreeIcons } from "@pierre/trees";
import pierreDarkTheme from "@pierre/theme/pierre-dark";
import type { CSSProperties } from "react";

export const treeDarkThemeStyles: CSSProperties = themeToTreeStyles({
  ...pierreDarkTheme,
  bg: "#000000",
  fg: "#d6d6d6",
  colors: {
    ...pierreDarkTheme.colors,
    "editor.background": "#000000",
    "editor.selectionBackground": "#242424",
    "focusBorder": "#3a3a3a",
    "input.background": "#0b0b0b",
    "input.border": "#151515",
    "list.activeSelectionBackground": "#242424",
    "list.activeSelectionForeground": "#d6d6d6",
    "list.focusOutline": "#3a3a3a",
    "list.hoverBackground": "#111111",
    "scrollbarSlider.background": "#636363",
    "sideBar.background": "#000000",
    "sideBar.border": "#151515",
    "sideBar.foreground": "#d6d6d6",
    "sideBarSectionHeader.background": "#000000",
    "sideBarSectionHeader.foreground": "#858585",
  },
});

export const fileTreeIcons: FileTreeIcons = {
  set: "complete",
  colored: true,
};

export const treeContentAlignmentCss = `
  :host {
    text-rendering: auto;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: auto;
  }

  [data-type='item'] {
    cursor: default;
    line-height: 1.2;
  }

  [data-item-section='content'],
  [data-item-flattened-subitems],
  [data-item-flattened-subitem],
  [data-truncate-container],
  [data-truncate-grid],
  [data-truncate-content='visible'] {
    line-height: 1.2;
  }

  [data-item-section='content'],
  [data-item-flattened-subitem] {
    display: flex;
    align-items: center;
  }

  [data-item-flattened-subitems] {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    max-width: 100%;
  }

  [data-item-flattened-subitem] {
    cursor: default;
    min-width: 0;
  }

  [data-type='context-menu-trigger'] {
    cursor: default;
  }

  [data-item-rename-input] {
    cursor: text;
  }

  [data-item-flattened-subitem] > [data-truncate-container] {
    margin-block: 0;
  }
`;
