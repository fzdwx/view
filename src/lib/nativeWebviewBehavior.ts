const textContextSelectors = [
  "input",
  "textarea",
  "[contenteditable='true']",
  ".file-editor",
  ".file-preview-code",
  ".diff-shell-content",
  ".diff-view",
  ".terminal-screen",
  ".terminal-output",
] as const;

const nativeWebviewBehaviorMark = "view:native-webview-behavior";

let nativeWebviewBehaviorInstalled = false;

export function installNativeWebviewBehavior(): void {
  if (nativeWebviewBehaviorInstalled) {
    return;
  }

  nativeWebviewBehaviorInstalled = true;
  document.documentElement.spellcheck = false;
  document.addEventListener("contextmenu", suppressChromeContextMenu, {
    capture: true,
  });
  performance.mark(nativeWebviewBehaviorMark);
}

function suppressChromeContextMenu(event: MouseEvent): void {
  if (isTextContextMenuTarget(event)) {
    return;
  }

  event.preventDefault();
}

function isTextContextMenuTarget(event: MouseEvent): boolean {
  for (const item of event.composedPath()) {
    if (!(item instanceof HTMLElement)) {
      continue;
    }

    if (textContextSelectors.some((selector) => item.matches(selector))) {
      return true;
    }
  }

  return false;
}
