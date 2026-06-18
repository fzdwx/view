import type { BranchInfo } from "./api";

export type BranchActionKind = "checkout" | "create" | "rename" | "delete";

export function defaultNewBranchName(branch: BranchInfo): string {
  if (branch.branchType === "remote") {
    const branchPath = branch.name.split("/").slice(1).join("/");
    return branchPath || "new-branch";
  }

  return `${branch.name}-copy`;
}

export function shortBranchDisplayName(branch: BranchInfo): string {
  if (branch.branchType === "remote") {
    return branch.name;
  }

  return branch.current ? "HEAD" : branch.name;
}
