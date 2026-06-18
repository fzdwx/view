import { Fragment } from "react";

interface ShortcutKeysProps {
  readonly shortcut: string;
}

/**
 * Renders a shortcut string (e.g. "Mod+Shift+]") as separated keyboard key
 * chips. `Mod` is shown as the platform modifier label; every other part is
 * shown verbatim. Unknown/empty values render a placeholder so the recorder
 * button still has a target.
 */
export function ShortcutKeys({ shortcut }: ShortcutKeysProps) {
  const parts = shortcut.split("+").filter((part) => part.length > 0);
  if (parts.length === 0) {
    return <span className="shortcut-keys-empty">None</span>;
  }

  return (
    <span className="shortcut-keys">
      {parts.map((part, index) => (
        <Fragment key={part}>
          {index > 0 ? <span className="shortcut-keys-sep">+</span> : null}
          <kbd className="shortcut-key">{modLabel(part)}</kbd>
        </Fragment>
      ))}
    </span>
  );
}

function modLabel(part: string): string {
  if (part === "Mod") {
    const isApple =
      typeof navigator !== "undefined" &&
      /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
    return isApple ? "⌘" : "Ctrl";
  }
  return part;
}
