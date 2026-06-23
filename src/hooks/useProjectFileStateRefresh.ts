import { useCallback } from "react";
import {
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

const durableProjectStateQueryRoots = [
  "changed-files",
  "commits",
  "project-files",
  "reflog",
  "repository",
] as const;

const previewStateQueryRoots = [
  "file-blame",
  "file-content",
  "file-staged-diff",
  "file-worktree-diff",
  "file-diff",
] as const;

async function refreshProjectFileStateQueries(
  queryClient: QueryClient,
  projectPath: string,
): Promise<void> {
  await Promise.all(
    previewStateQueryRoots.map((queryRoot) =>
      queryClient.cancelQueries({ queryKey: [queryRoot, projectPath] }),
    ),
  );

  await Promise.all([
    ...durableProjectStateQueryRoots.map((queryRoot) =>
      queryClient.invalidateQueries({ queryKey: [queryRoot, projectPath] }),
    ),
    ...previewStateQueryRoots.map((queryRoot) =>
      queryClient.resetQueries({ queryKey: [queryRoot, projectPath] }),
    ),
  ]);
}

export function useProjectFileStateRefresh(): (
  projectPath: string,
) => Promise<void> {
  const queryClient = useQueryClient();

  return useCallback(
    (projectPath: string) =>
      refreshProjectFileStateQueries(queryClient, projectPath),
    [queryClient],
  );
}
