import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getFileRunTargets,
  isTauriRuntime,
  type FileRunTarget,
} from "../lib/api";
import { requireQueryInput } from "../lib/queryInput";

const runTargetContentDebounceMs = 180;

interface LoadedFileRunTargets {
  readonly rootPath: string;
  readonly filePath: string;
  readonly targets: readonly FileRunTarget[];
}

export function useFileRunTargets({
  content,
  enabled,
  filePath,
  projectPath,
}: {
  readonly content: string;
  readonly enabled: boolean;
  readonly filePath: string | null;
  readonly projectPath: string | null;
}): readonly FileRunTarget[] {
  const [debouncedContent, setDebouncedContent] = useState(content);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedContent(content);
    }, runTargetContentDebounceMs);

    return () => window.clearTimeout(timer);
  }, [content]);

  const query = useQuery<LoadedFileRunTargets, Error>({
    queryKey: ["file-run-targets", projectPath, filePath, debouncedContent],
    queryFn: async () => {
      const rootPath = requireQueryInput(projectPath, "run target project path");
      const selectedFilePath = requireQueryInput(filePath, "run target file path");
      return {
        rootPath,
        filePath: selectedFilePath,
        targets: await getFileRunTargets(
          rootPath,
          selectedFilePath,
          debouncedContent,
        ),
      };
    },
    enabled: enabled && isTauriRuntime() && Boolean(projectPath && filePath),
    retry: false,
  });

  if (
    query.data?.rootPath !== projectPath ||
    query.data?.filePath !== filePath
  ) {
    return [];
  }

  return query.data.targets;
}
