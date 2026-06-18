import type { MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { BranchInfo, TagInfo } from "../../lib/api";
import type { BranchActionKind } from "../../lib/branchModels";
import { filterRefs } from "../../lib/branchTree";
import { BranchGroup } from "./BranchGroup";
import { BranchContextMenu } from "./BranchContextMenu";
import { TagGroup } from "./TagGroup";

type BranchMenuState = {
  readonly branch: BranchInfo;
  readonly left: number;
  readonly top: number;
};

export function BranchTree({
  branches,
  tags,
  activeRef,
  onBranchAction,
  onSelect,
}: {
  branches: BranchInfo[];
  tags: TagInfo[];
  activeRef: string | null;
  onBranchAction(action: BranchActionKind, branch: BranchInfo): void;
  onSelect(refName: string): void;
}) {
  const [branchFilter, setBranchFilter] = useState("");
  const [branchMenu, setBranchMenu] = useState<BranchMenuState | null>(null);
  const filtering = branchFilter.trim().length > 0;
  const localBranches = useMemo(
    () =>
      filterRefs(
        branches.filter((branch) => branch.branchType === "local"),
        branchFilter,
      ),
    [branches, branchFilter],
  );
  const remoteBranches = useMemo(
    () =>
      filterRefs(
        branches.filter((branch) => branch.branchType === "remote"),
        branchFilter,
      ),
    [branches, branchFilter],
  );
  const visibleTags = useMemo(
    () => filterRefs(tags, branchFilter),
    [tags, branchFilter],
  );
  const currentBranch = branches.find((branch) => branch.current);
  const showCurrentBranch =
    currentBranch && filterRefs([currentBranch], branchFilter).length > 0;
  const refCount = branches.length + tags.length;
  const visibleRefCount = localBranches.length + remoteBranches.length + visibleTags.length;
  const refCountLabel = filtering ? `${visibleRefCount} / ${refCount}` : `${refCount}`;

  useEffect(() => {
    if (!branchMenu) {
      return;
    }

    const closeMenu = () => setBranchMenu(null);
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [branchMenu]);

  function openBranchMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
    branch: BranchInfo,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setBranchMenu({
      branch,
      left: event.clientX,
      top: event.clientY,
    });
  }

  function executeBranchAction(action: BranchActionKind, branch: BranchInfo) {
    setBranchMenu(null);
    onBranchAction(action, branch);
  }

  return (
    <div className="branch-tree">
      <label className="search-field branch-search">
        <Search size={15} />
        <input
          value={branchFilter}
          onChange={(event) => setBranchFilter(event.target.value)}
          placeholder="Filter branches"
        />
        <span className="search-count">{refCountLabel}</span>
      </label>

      <div className="branch-scroll">
        {showCurrentBranch ? (
          <button
            className={
              currentBranch.refName === activeRef
                ? "branch-head-row active"
                : "branch-head-row"
            }
            onClick={() => onSelect(currentBranch.refName)}
            onContextMenu={(event) => openBranchMenu(event, currentBranch)}
          >
            <span>HEAD</span>
            <small>{currentBranch.name}</small>
          </button>
        ) : null}
        <BranchGroup
          title="Local"
          branches={localBranches}
          filtering={filtering}
          activeRef={activeRef}
          onSelect={onSelect}
          onBranchContextMenu={openBranchMenu}
        />
        <BranchGroup
          title="Remote"
          branches={remoteBranches}
          filtering={filtering}
          activeRef={activeRef}
          onSelect={onSelect}
          onBranchContextMenu={openBranchMenu}
        />
        <TagGroup tags={visibleTags} activeRef={activeRef} onSelect={onSelect} />
      </div>
      {branchMenu ? (
        <BranchContextMenu
          branch={branchMenu.branch}
          left={branchMenu.left}
          top={branchMenu.top}
          onAction={executeBranchAction}
        />
      ) : null}
    </div>
  );
}
