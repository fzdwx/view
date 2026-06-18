import type { BranchInfo } from "./api";

export type RefLeaf = {
  readonly name: string;
  readonly refName: string;
  readonly branchType: BranchInfo["branchType"];
  readonly current: boolean;
  readonly ahead: number | null;
  readonly behind: number | null;
  readonly upstream: string | null;
  readonly kind: "branch";
};

export type RefNode = {
  readonly key: string;
  readonly name: string;
  readonly children: RefNode[];
  readonly leaf?: RefLeaf;
};

export function branchToRefLeaf(branch: BranchInfo): RefLeaf {
  return {
    name: branch.name,
    refName: branch.refName,
    current: branch.current,
    branchType: branch.branchType,
    ahead: branch.ahead,
    behind: branch.behind,
    upstream: branch.upstream,
    kind: "branch",
  };
}

export function filterRefs<T extends { readonly name: string; readonly refName: string }>(
  refs: readonly T[],
  filter: string,
): T[] {
  const normalized = filter.trim().toLowerCase();
  if (!normalized) {
    return Array.from(refs);
  }

  return refs.filter((ref) =>
    `${ref.name} ${ref.refName}`.toLowerCase().includes(normalized),
  );
}

export function buildRefTree(refs: readonly RefLeaf[]): RefNode[] {
  const root: RefNode[] = [];

  for (const ref of refs) {
    const parts = ref.name.split("/").filter(Boolean);
    let siblings = root;
    let keyPath = "";

    parts.forEach((part, index) => {
      keyPath = keyPath ? `${keyPath}/${part}` : part;
      const isLeaf = index === parts.length - 1;

      if (isLeaf) {
        siblings.push({
          key: ref.refName,
          name: part,
          children: [],
          leaf: ref,
        });
        return;
      }

      let folder = siblings.find((node) => !node.leaf && node.name === part);
      if (!folder) {
        folder = {
          key: keyPath,
          name: part,
          children: [],
        };
        siblings.push(folder);
      }
      siblings = folder.children;
    });
  }

  sortRefNodes(root);
  return root;
}

function sortRefNodes(nodes: RefNode[]) {
  nodes.sort((left, right) => {
    if (!left.leaf && right.leaf) {
      return -1;
    }
    if (left.leaf && !right.leaf) {
      return 1;
    }
    return left.name.localeCompare(right.name);
  });
  nodes.forEach((node) => sortRefNodes(node.children));
}
