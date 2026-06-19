export function matchesShortcut(
  event: globalThis.KeyboardEvent,
  shortcut: string,
): boolean {
  const parts = shortcut.split("+").flatMap((part) => {
    const normalized = part.trim().toLowerCase();
    return normalized ? [normalized] : [];
  });
  if (parts.length === 0) {
    return false;
  }

  const key = parts.at(-1);
  if (!key || key === "mod" || key === "ctrl" || key === "control") {
    return false;
  }

  const expectsMod = parts.includes("mod");
  const expectsCtrl = parts.includes("ctrl") || parts.includes("control");
  const expectsMeta = parts.includes("cmd") || parts.includes("meta");
  const expectsShift = parts.includes("shift");
  const expectsAlt = parts.includes("alt") || parts.includes("option");
  if (expectsMod && !(event.metaKey || event.ctrlKey)) {
    return false;
  }
  if (!expectsMod && event.metaKey !== expectsMeta) {
    return false;
  }
  if (!expectsMod && event.ctrlKey !== expectsCtrl) {
    return false;
  }
  if (event.shiftKey !== expectsShift || event.altKey !== expectsAlt) {
    return false;
  }

  return normalizeShortcutKey(event.key) === normalizeShortcutKey(key);
}

function normalizeShortcutKey(key: string): string {
  const normalized = key.trim().toLowerCase();
  if (normalized === "space") {
    return " ";
  }
  if (normalized === "esc") {
    return "escape";
  }
  if (normalized === "return") {
    return "enter";
  }
  if (normalized === "backquote") {
    return "`";
  }
  return normalized;
}
