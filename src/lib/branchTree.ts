import type { BranchInfo, TagInfo } from "./api";

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

export type RefSectionId = "local" | "remote" | "tags";

export type VirtualRefRow =
  | {
      readonly key: string;
      readonly kind: "head";
      readonly branch: BranchInfo;
    }
  | {
      readonly key: string;
      readonly kind: "section";
      readonly section: RefSectionId;
      readonly title: string;
      readonly count: number;
      readonly collapsible: boolean;
      readonly collapsed: boolean;
    }
  | {
      readonly key: string;
      readonly kind: "folder";
      readonly section: Exclude<RefSectionId, "tags">;
      readonly folderKey: string;
      readonly name: string;
      readonly depth: number;
      readonly collapsed: boolean;
    }
  | {
      readonly key: string;
      readonly kind: "branch";
      readonly section: Exclude<RefSectionId, "tags">;
      readonly branch: RefLeaf;
      readonly depth: number;
    }
  | {
      readonly key: string;
      readonly kind: "tag";
      readonly section: "tags";
      readonly tag: TagInfo;
      readonly depth: number;
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

  const folderIndex = new WeakMap<RefNode[], Map<string, RefNode>>();

  const getFolderByName = (siblings: RefNode[], part: string) => {
    let byName = folderIndex.get(siblings);
    if (!byName) {
      byName = new Map();
      folderIndex.set(siblings, byName);
    }
    return byName.get(part);
  };

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

      let folder = getFolderByName(siblings, part);
      if (!folder) {
        folder = {
          key: keyPath,
          name: part,
          children: [],
        };
        siblings.push(folder);
        folderIndex.get(siblings)?.set(part, folder);
      }
      siblings = folder.children;
    });
  }

  sortRefNodes(root);
  return root;
}

export function buildBranchTreeRows({
  currentBranch,
  showCurrentBranch,
  localBranches,
  remoteBranches,
  tags,
  filtering,
  collapsedBranchSections,
  collapsedFolders,
}: {
  readonly currentBranch: BranchInfo | null;
  readonly showCurrentBranch: boolean;
  readonly localBranches: readonly BranchInfo[];
  readonly remoteBranches: readonly BranchInfo[];
  readonly tags: readonly TagInfo[];
  readonly filtering: boolean;
  readonly collapsedBranchSections: ReadonlySet<Exclude<RefSectionId, "tags">>;
  readonly collapsedFolders: ReadonlySet<string>;
}): VirtualRefRow[] {
  const rows: VirtualRefRow[] = [];

  if (showCurrentBranch && currentBranch) {
    rows.push({
      key: `head:${currentBranch.refName}`,
      kind: "head",
      branch: currentBranch,
    });
  }

  appendBranchSectionRows(rows, {
    branches: localBranches,
    collapsed: collapsedBranchSections.has("local"),
    collapsedFolders,
    filtering,
    section: "local",
    title: "Local",
  });
  appendBranchSectionRows(rows, {
    branches: remoteBranches,
    collapsed: collapsedBranchSections.has("remote"),
    collapsedFolders,
    filtering,
    section: "remote",
    title: "Remote",
  });
  appendTagSectionRows(rows, tags);

  return rows;
}

export function refRowSectionTitle(row: VirtualRefRow): string {
  switch (row.kind) {
    case "head":
      return "Current";
    case "section":
      return row.title;
    case "folder":
      return row.section === "local" ? "Local" : "Remote";
    case "branch":
      return row.section === "local" ? "Local" : "Remote";
    case "tag":
      return "Tags";
  }
}

function appendBranchSectionRows(
  rows: VirtualRefRow[],
  {
    branches,
    collapsed,
    collapsedFolders,
    filtering,
    section,
    title,
  }: {
    readonly branches: readonly BranchInfo[];
    readonly collapsed: boolean;
    readonly collapsedFolders: ReadonlySet<string>;
    readonly filtering: boolean;
    readonly section: Exclude<RefSectionId, "tags">;
    readonly title: string;
  },
) {
  if (branches.length === 0) {
    return;
  }

  rows.push({
    key: `section:${section}`,
    kind: "section",
    section,
    title,
    count: branches.length,
    collapsible: true,
    collapsed,
  });

  if (collapsed && !filtering) {
    return;
  }

  const tree = buildRefTree(branches.map(branchToRefLeaf));
  appendRefNodes(rows, tree, {
    collapsedFolders,
    filtering,
    section,
    depth: 0,
  });
}

function appendRefNodes(
  rows: VirtualRefRow[],
  nodes: readonly RefNode[],
  {
    collapsedFolders,
    filtering,
    section,
    depth,
  }: {
    readonly collapsedFolders: ReadonlySet<string>;
    readonly filtering: boolean;
    readonly section: Exclude<RefSectionId, "tags">;
    readonly depth: number;
  },
) {
  for (const node of nodes) {
    if (node.leaf) {
      rows.push({
        key: `branch:${node.leaf.refName}`,
        kind: "branch",
        section,
        branch: node.leaf,
        depth,
      });
      continue;
    }

    const folderKey = `${section}:${node.key}`;
    const collapsed = !filtering && collapsedFolders.has(folderKey);
    rows.push({
      key: `folder:${folderKey}`,
      kind: "folder",
      section,
      folderKey,
      name: node.name,
      depth,
      collapsed,
    });

    if (!collapsed) {
      appendRefNodes(rows, node.children, {
        collapsedFolders,
        filtering,
        section,
        depth: depth + 1,
      });
    }
  }
}

function appendTagSectionRows(rows: VirtualRefRow[], tags: readonly TagInfo[]) {
  if (tags.length === 0) {
    return;
  }

  rows.push({
    key: "section:tags",
    kind: "section",
    section: "tags",
    title: "Tags",
    count: tags.length,
    collapsible: false,
    collapsed: false,
  });

  tags.forEach((tag) => {
    rows.push({
      key: `tag:${tag.refName}`,
      kind: "tag",
      section: "tags",
      tag,
      depth: 0,
    });
  });
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
