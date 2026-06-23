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
    --view-tree-conflict-color: var(--danger, #ff2e3f);
    --view-tree-staged-color: var(--success, #07c480);
    --view-tree-unstaged-color: color-mix(
      in oklch,
      var(--warning, #ffca00) 58%,
      var(--muted, #858585)
    );

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

  [data-item-section='decoration'] > span[title='Conflicted change'],
  [data-item-section='decoration'] > span[title='Staged change'],
  [data-item-section='decoration'] > span[title='Unstaged change'],
  [data-item-section='decoration'] > span[title='Staged and unstaged changes'] {
    min-width: 15px;
    max-width: none;
    height: 14px;
    border: 1px solid currentColor;
    border-radius: 3px;
    font-family: var(--trees-font-family);
    font-size: 9px;
    font-weight: 600;
    line-height: 12px;
    padding: 0 3px;
    justify-content: center;
    opacity: 0.95;
  }

  [data-item-section='decoration'] > span[title='Conflicted change'] {
    color: var(--view-tree-conflict-color);
    background: color-mix(
      in oklch,
      var(--view-tree-conflict-color) 13%,
      transparent
    );
  }

  [data-item-section='decoration'] > span[title='Staged change'] {
    color: var(--view-tree-staged-color);
    background: color-mix(
      in oklch,
      var(--view-tree-staged-color) 13%,
      transparent
    );
  }

  [data-item-section='decoration'] > span[title='Unstaged change'] {
    color: var(--view-tree-unstaged-color);
    background: color-mix(
      in oklch,
      var(--view-tree-unstaged-color) 11%,
      transparent
    );
  }

  [data-item-section='decoration'] > span[title='Staged and unstaged changes'] {
    color: var(--view-tree-staged-color);
    border-color: color-mix(
      in oklch,
      var(--view-tree-staged-color) 58%,
      var(--view-tree-unstaged-color)
    );
    background: linear-gradient(
      90deg,
      color-mix(in oklch, var(--view-tree-staged-color) 15%, transparent) 0 50%,
      color-mix(in oklch, var(--view-tree-unstaged-color) 15%, transparent) 50%
    );
  }
`;
