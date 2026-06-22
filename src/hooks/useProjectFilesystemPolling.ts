import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { isTauriRuntime } from "../lib/api";

const PROJECT_STATE_POLL_INTERVAL_MS = 2500;

export interface UseProjectFilesystemPollingOptions {
  readonly activeProjectPath: string | null;
}

export function useProjectFilesystemPolling({
  activeProjectPath,
}: UseProjectFilesystemPollingOptions): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!activeProjectPath || !isTauriRuntime()) {
      return;
    }

    const projectPath = activeProjectPath;
    let refreshInFlight = false;

    function refresh(): void {
      if (refreshInFlight) {
        return;
      }

      refreshInFlight = true;
      void refreshProjectStateQueries(queryClient, projectPath).then(
        () => {
          refreshInFlight = false;
        },
        (error: unknown) => {
          refreshInFlight = false;
          if (error instanceof Error) {
            console.warn("Project state polling failed", error);
            return;
          }
          console.warn("Project state polling failed with non-Error rejection", error);
        },
      );
    }

    refresh();
    window.addEventListener("focus", refresh);
    const pollingTimer = window.setInterval(
      refresh,
      PROJECT_STATE_POLL_INTERVAL_MS,
    );

    return () => {
      window.clearInterval(pollingTimer);
      window.removeEventListener("focus", refresh);
    };
  }, [activeProjectPath, queryClient]);
}

async function refreshProjectStateQueries(
  queryClient: QueryClient,
  projectPath: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["repository", projectPath] }),
    queryClient.invalidateQueries({ queryKey: ["project-files", projectPath] }),
    queryClient.invalidateQueries({ queryKey: ["changed-files", projectPath] }),
  ]);
}
