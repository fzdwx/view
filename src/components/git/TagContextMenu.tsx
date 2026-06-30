import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Trash2, Upload } from "lucide-react";
import type { TagInfo } from "../../lib/api";
import { clamp } from "../../lib/numeric";

export type TagContextAction = "delete" | "push";

export function TagContextMenu({
  left,
  tag,
  top,
  onAction,
}: {
  readonly left: number;
  readonly tag: TagInfo;
  readonly top: number;
  readonly onAction: (action: TagContextAction, tag: TagInfo) => void;
}) {
  const menuStyle: CSSProperties = {
    left: clamp(left, 8, window.innerWidth - 216),
    top: clamp(top, 8, window.innerHeight - 96),
  };

  return createPortal(
    <div
      className="branch-context-menu"
      role="menu"
      tabIndex={-1}
      style={menuStyle}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={() => onAction("push", tag)}>
        <Upload size={13} />
        <span>Push tag</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="danger"
        onClick={() => onAction("delete", tag)}
      >
        <Trash2 size={13} />
        <span>Delete tag</span>
      </button>
    </div>,
    document.body,
  );
}
