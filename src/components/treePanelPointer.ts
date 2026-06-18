import type { MouseEvent as ReactMouseEvent } from "react";

export interface ClickedFilePath {
  readonly path: string;
  readonly selected: boolean;
}

export function getClickedFilePath(
  event: ReactMouseEvent<HTMLElement>,
): ClickedFilePath | null {
  if (
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.defaultPrevented
  ) {
    return null;
  }

  for (const item of event.nativeEvent.composedPath()) {
    if (!(item instanceof HTMLElement)) {
      continue;
    }
    if (isTreeMenuOrEditorTarget(item)) {
      return null;
    }
    if (item.dataset.itemType === "file") {
      const path = item.dataset.itemPath;
      return path
        ? {
            path,
            selected: item.hasAttribute("data-item-selected"),
          }
        : null;
    }
  }

  return null;
}

function isTreeMenuOrEditorTarget(element: HTMLElement): boolean {
  return (
    element.dataset.fileTreeContextMenuRoot === "true" ||
    element.dataset.type === "context-menu-trigger" ||
    element.hasAttribute("data-item-rename-input") ||
    element.matches("input, textarea, button, [contenteditable='true']")
  );
}
