import { prepareFileTreeInput } from "@pierre/trees";
import type { GitStatusEntry } from "@pierre/trees";
import type { TreeFile } from "../lib/api";

export interface TreePanelData {
  readonly fileByPath: ReadonlyMap<string, TreeFile>;
  readonly gitStatus: readonly GitStatusEntry[];
  readonly paths: readonly string[];
  readonly preparedInput: ReturnType<typeof prepareFileTreeInput>;
  readonly selectablePaths: ReadonlySet<string>;
}

export function buildTreePanelData(files: readonly TreeFile[]): TreePanelData {
  const inputPaths = uniqueInputPaths(files);
  const preparedInput = prepareFileTreeInput(inputPaths);
  const paths = preparedInput.paths;
  const selectablePaths = new Set(paths);
  const fileByPath = new Map<string, TreeFile>();
  const statusByPath = new Map<string, NonNullable<TreeFile["status"]>>();

  for (const file of files) {
    if (selectablePaths.has(file.path)) {
      fileByPath.set(file.path, file);
    }
    if (file.status && selectablePaths.has(file.path)) {
      statusByPath.set(file.path, file.status);
    }
  }

  const gitStatus = [...statusByPath].map(([path, status]) => ({
    path,
    status: status === "conflict" ? "modified" : status,
  })) satisfies GitStatusEntry[];

  return {
    fileByPath,
    gitStatus,
    paths,
    preparedInput,
    selectablePaths,
  };
}

export function ancestorDirectoryPaths(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const directories: string[] = [];

  for (let index = 1; index < parts.length; index += 1) {
    directories.push(`${parts.slice(0, index).join("/")}/`);
  }

  return directories;
}

export function directoryPathsFor(paths: readonly string[]): string[] {
  const directories = new Set<string>();
  for (const path of paths) {
    for (const directoryPath of ancestorDirectoryPaths(path)) {
      directories.add(directoryPath);
    }
  }
  return [...directories];
}

function uniqueInputPaths(files: readonly TreeFile[]): string[] {
  const seenPaths = new Set<string>();
  const paths: string[] = [];

  for (const file of files) {
    const path = file.path;
    if (!path || seenPaths.has(path)) {
      continue;
    }
    seenPaths.add(path);
    paths.push(path);
  }

  return paths;
}
