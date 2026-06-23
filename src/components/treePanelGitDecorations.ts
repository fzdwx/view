import type { FileTreeRowDecoration } from "@pierre/trees";
import type { TreeFile } from "../lib/api";

type TreeGitStageDecorationKind =
  | "conflict"
  | "mixed"
  | "staged"
  | "unstaged";

const TREE_GIT_STAGE_DECORATION = {
  conflict: { text: "!", title: "Conflicted change" },
  mixed: { text: "S/U", title: "Staged and unstaged changes" },
  staged: { text: "S", title: "Staged change" },
  unstaged: { text: "U", title: "Unstaged change" },
} as const satisfies Record<TreeGitStageDecorationKind, FileTreeRowDecoration>;

export function treeGitStageDecoration(
  file: TreeFile | null,
): FileTreeRowDecoration | null {
  if (file == null) {
    return null;
  }
  if (file.conflict === true || file.status === "conflict") {
    return TREE_GIT_STAGE_DECORATION.conflict;
  }

  const hasStagedChange = file.staged === true;
  const hasUnstagedChange =
    file.unstaged === true || file.untracked === true;

  if (hasStagedChange && hasUnstagedChange) {
    return TREE_GIT_STAGE_DECORATION.mixed;
  }
  if (hasStagedChange) {
    return TREE_GIT_STAGE_DECORATION.staged;
  }
  if (hasUnstagedChange) {
    return TREE_GIT_STAGE_DECORATION.unstaged;
  }
  return null;
}
