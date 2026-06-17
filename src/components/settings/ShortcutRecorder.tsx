import { type KeyboardEvent as ReactKeyboardEvent, useState } from "react";
import { Keyboard } from "lucide-react";
import type { ShortcutAction } from "../../lib/settings";

interface ShortcutRecorderProps {
  readonly value: string;
  readonly onChange: (shortcut: string) => void;
}

export function ShortcutRecorder({ value, onChange }: ShortcutRecorderProps) {
  const [recording, setRecording] = useState(false);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!recording) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setRecording(false);
      return;
    }
    if (isModifierKey(event.key)) {
      return;
    }

    const shortcut = formatRecordedShortcut(event);
    if (shortcut) {
      onChange(shortcut);
      setRecording(false);
    }
  }

  return (
    <button
      type="button"
      className={recording ? "shortcut-recorder recording" : "shortcut-recorder"}
      aria-label={recording ? "Recording shortcut" : `Record shortcut ${value}`}
      onBlur={() => setRecording(false)}
      onClick={() => setRecording((current) => !current)}
      onKeyDown={handleKeyDown}
    >
      <Keyboard size={12} />
      <span>{recording ? "Press keys..." : value}</span>
    </button>
  );
}

export type ShortcutChangeHandler = (
  action: ShortcutAction,
  shortcut: string,
) => void;

function formatRecordedShortcut(
  event: ReactKeyboardEvent<HTMLButtonElement>,
): string | null {
  const key = shortcutKeyLabel(event);
  if (!key) {
    return null;
  }

  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) {
    parts.push("Mod");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }
  parts.push(key);
  return parts.join("+");
}

function shortcutKeyLabel(event: ReactKeyboardEvent<HTMLButtonElement>): string | null {
  if (event.key === " ") {
    return "Space";
  }
  if (event.code === "Backquote" && event.key !== "~") {
    return "`";
  }
  if (event.key.length === 1) {
    return event.key.toUpperCase();
  }

  const aliases: Record<string, string> = {
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    ArrowUp: "ArrowUp",
    Backspace: "Backspace",
    Delete: "Delete",
    End: "End",
    Enter: "Enter",
    Escape: "Escape",
    Home: "Home",
    PageDown: "PageDown",
    PageUp: "PageUp",
    Tab: "Tab",
  };
  return aliases[event.key] ?? null;
}

function isModifierKey(key: string): boolean {
  return key === "Alt" || key === "Control" || key === "Meta" || key === "Shift";
}
