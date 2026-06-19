import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Folder, GitBranch } from "lucide-react";
import type { BranchInfo } from "../../lib/api";
import {
  branchToRefLeaf,
  buildRefTree,
  type RefLeaf,
  type RefNode,
} from "../../lib/branchTree";

export function BranchGroup({
  title,
  branches,
  filtering,
  activeRef,
  onSelect,
  onBranchContextMenu,
}: {
  title: string;
  branches: BranchInfo[];
  filtering: boolean;
  activeRef: string | null;
  onSelect(refName: string): void;
  onBranchContextMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
    branch: BranchInfo,
  ): void;
}) {
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapsed, setCollapsed] = useState(false);
  const tree = useMemo(
    () => buildRefTree(branches.map(branchToRefLeaf)),
    [branches],
  );

  if (branches.length === 0) {
    return null;
  }

  function toggleFolder(key: string) {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <div className="branch-group">
     <button
       className="branch-group-title"
        type="button"
        aria-expanded={!collapsed || filtering}
       onClick={() => setCollapsed((current) => !current)}
      >
        {collapsed && !filtering ? (
          <ChevronRight size={14} />
        ) : (
          <ChevronDown size={14} />
        )}
        <span>{title}</span>
      </button>
      {collapsed && !filtering
        ? null
        : tree.map((node) => (
            <RefTreeNode
              key={node.key}
              node={node}
              activeRef={activeRef}
              depth={0}
              filtering={filtering}
              onSelect={onSelect}
              onBranchContextMenu={onBranchContextMenu}
              collapsedFolders={collapsedFolders}
              onToggleFolder={toggleFolder}
            />
          ))}
    </div>
  );
}

function RefTreeNode({
  node,
  activeRef,
  depth,
  filtering,
  onSelect,
  onBranchContextMenu,
  collapsedFolders,
  onToggleFolder,
}: {
  node: RefNode;
  activeRef: string | null;
  depth: number;
  filtering: boolean;
  onSelect(refName: string): void;
  onBranchContextMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
    branch: BranchInfo,
  ): void;
  collapsedFolders: Set<string>;
  onToggleFolder(key: string): void;
}) {
  if (node.leaf) {
    return (
     <button
       className={
         node.leaf.refName === activeRef ? "branch-row active" : "branch-row"
       }
        type="button"
        style={{ "--branch-depth": depth } as CSSProperties}
        onClick={() => node.leaf && onSelect(node.leaf.refName)}
        onContextMenu={(event) => {
          if (node.leaf) {
            onBranchContextMenu(event, node.leaf);
          }
        }}
      >
        <GitBranch size={13} />
        <span>{node.name}</span>
        <BranchTrackingBadge branch={node.leaf} />
      </button>
    );
  }

  const collapsed = !filtering && collapsedFolders.has(node.key);

  return (
    <div className="branch-folder">
     <button
       className="branch-folder-row"
        type="button"
        style={{ "--branch-depth": depth } as CSSProperties}
        aria-expanded={!collapsed}
        onClick={() => onToggleFolder(node.key)}
      >
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        <Folder size={13} />
        <span>{node.name}</span>
      </button>
      {collapsed ? null : node.children.map((child) => (
        <RefTreeNode
          key={child.key}
          node={child}
          activeRef={activeRef}
          depth={depth + 1}
          filtering={filtering}
          onSelect={onSelect}
          onBranchContextMenu={onBranchContextMenu}
          collapsedFolders={collapsedFolders}
          onToggleFolder={onToggleFolder}
        />
      ))}
    </div>
  );
}

function BranchTrackingBadge({ branch }: { branch: RefLeaf }) {
  const hasAhead = Boolean(branch.ahead && branch.ahead > 0);
  const hasBehind = Boolean(branch.behind && branch.behind > 0);
  const otherLabel = branch.branchType === "remote" ? "remote" : "upstream";

  if (branch.current || hasAhead || hasBehind) {
    return (
      <small className="branch-badges">
        {hasBehind ? (
          <span className="branch-behind" title={`${otherLabel} has commits not in local`}>
            ↙ {branch.behind}
          </span>
        ) : null}
        {hasAhead ? (
          <span className="branch-ahead" title={`Local has commits not in ${otherLabel}`}>
            ↗ {branch.ahead}
          </span>
        ) : null}
        {branch.current ? <span className="branch-head-badge">HEAD</span> : null}
      </small>
    );
  }

  return null;
}
