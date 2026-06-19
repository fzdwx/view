import type { CSSProperties } from "react";
import { Copy, X } from "lucide-react";
import { clamp } from "../lib/numeric";

export interface TabContextMenuAction {
  type: "close" | "closeOthers" | "closeAll" | "copyPath";
}

export function TabContextMenu({
  left,
  top,
  onClose,
  onCloseOthers,
  onCloseAll,
  onCopyPath,
}: {
  left: number;
  top: number;
  onClose(): void;
  onCloseOthers(): void;
  onCloseAll(): void;
  onCopyPath(): void;
}) {
  const menuStyle: CSSProperties = {
    left: clamp(left, 8, window.innerWidth - 216),
    top: clamp(top, 8, window.innerHeight - 180),
  };

  return (
    <div
      className="branch-context-menu"
      role="menu"
      tabIndex={-1}
      style={menuStyle}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={onClose}>
        <X size={13} />
        <span>Close</span>
      </button>
      <button type="button" role="menuitem" onClick={onCloseOthers}>
        <X size={13} />
        <span>Close Others</span>
      </button>
      <button type="button" role="menuitem" onClick={onCloseAll}>
        <X size={13} />
        <span>Close All</span>
      </button>
      <button type="button" role="menuitem" onClick={onCopyPath}>
        <Copy size={13} />
        <span>Copy Path</span>
      </button>
    </div>
  );
}
