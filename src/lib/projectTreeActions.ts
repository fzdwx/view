import { parentPathFromPath } from "./pathLabels";

export type ProjectTreeItemKind = "directory" | "file";

export interface ProjectTreeContextAvailability {
  readonly canCopyRelativePath: boolean;
  readonly canCreateFolder: boolean;
  readonly canDelete: boolean;
  readonly canIgnore: boolean;
  readonly canRename: boolean;
  readonly canReveal: boolean;
}

export function directoryPathForNewChild(
  kind: ProjectTreeItemKind,
  path: string,
): string | null {
  const normalized = copyRelativePathText(path);
  if (kind === "directory") {
    return normalized || null;
  }
  const parent = parentPathFromPath(normalized);
  return parent || null;
}

export function ignorePatternForTreePath(
  path: string,
  kind: ProjectTreeItemKind,
): string {
  const normalized = copyRelativePathText(path);
  if (kind === "directory") {
    return `${normalized.replace(/\/+$/, "")}/`;
  }
  return normalized;
}

export function copyRelativePathText(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/^\/+/, "");
}

export function projectTreeContextAvailability(
  _kind: ProjectTreeItemKind,
): ProjectTreeContextAvailability {
  return {
    canCopyRelativePath: true,
    canCreateFolder: true,
    canDelete: true,
    canIgnore: true,
    canRename: true,
    canReveal: true,
  };
}
