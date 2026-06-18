import type { CSSProperties } from "react";
import { GitBranch, PenLine, Plus, Trash2 } from "lucide-react";
import type { BranchInfo } from "../../lib/api";
import type { BranchActionKind } from "../../lib/branchModels";
import { clamp } from "../../lib/numeric";

export function BranchContextMenu({
  branch,
  left,
  top,
  onAction,
}: {
  branch: BranchInfo;
  left: number;
  top: number;
  onAction(action: BranchActionKind, branch: BranchInfo): void;
}) {
  const isLocal = branch.branchType === "local";
  const menuStyle: CSSProperties = {
    left: clamp(left, 8, window.innerWidth - 216),
    top: clamp(top, 8, window.innerHeight - 154),
  };

  return (
    <div
      className="branch-context-menu"
      role="menu"
      style={menuStyle}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={() => onAction("checkout", branch)}>
        <GitBranch size={13} />
        <span>{isLocal ? "Checkout" : "Checkout tracking"}</span>
      </button>
      <button type="button" role="menuitem" onClick={() => onAction("create", branch)}>
        <Plus size={13} />
        <span>New branch from here</span>
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!isLocal}
        onClick={() => onAction("rename", branch)}
      >
        <PenLine size={13} />
        <span>Rename</span>
      </button>
      <button
        type="button"
        role="menuitem"
        className="danger"
        disabled={!isLocal || branch.current}
        onClick={() => onAction("delete", branch)}
      >
        <Trash2 size={13} />
        <span>Delete</span>
      </button>
    </div>
  );
}
