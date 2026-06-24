import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  getProjectStateFingerprint,
  isTauriRuntime,
  type ProjectStateFingerprint,
} from "../lib/api";
import { logPerf } from "../lib/performanceLog";

const PROJECT_STATE_POLL_INTERVAL_MS = 2500;
const PROJECT_STATE_POLL_WARN_MS = 100;

type ProjectStatePollSource = "focus" | "initial" | "interval";

export interface UseProjectFilesystemPollingOptions {
  readonly activeCommit: string | null;
  readonly activeProjectPath: string | null;
}

export function useProjectFilesystemPolling({
  activeCommit,
  activeProjectPath,
}: UseProjectFilesystemPollingOptions): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!activeProjectPath || !isTauriRuntime()) {
      return;
    }

    const projectPath = activeProjectPath;
    let refreshInFlight = false;
    let lastFingerprint: ProjectStateFingerprint | null = null;

    function refresh(source: ProjectStatePollSource): void {
      if (refreshInFlight) {
        logPerf("poll:project-state", 0, { source, result: "skipped-in-flight" });
        return;
      }

      refreshInFlight = true;
      void refreshProjectStateQueries(queryClient, projectPath, activeCommit, source, {
        current: lastFingerprint,
        set: (fingerprint) => {
          lastFingerprint = fingerprint;
        },
      }).then(
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

    const refreshFromFocus = () => refresh("focus");
    refresh("initial");
    window.addEventListener("focus", refreshFromFocus);
    const pollingTimer = window.setInterval(
      () => refresh("interval"),
      PROJECT_STATE_POLL_INTERVAL_MS,
    );

    return () => {
      window.clearInterval(pollingTimer);
      window.removeEventListener("focus", refreshFromFocus);
    };
  }, [activeCommit, activeProjectPath, queryClient]);
}

async function refreshProjectStateQueries(
  queryClient: QueryClient,
  projectPath: string,
  activeCommit: string | null,
  source: ProjectStatePollSource,
  lastFingerprintRef?: {
    readonly current: ProjectStateFingerprint | null;
    readonly set: (fingerprint: ProjectStateFingerprint) => void;
  },
): Promise<void> {
  const startedAt = performance.now();
  const nextFingerprint = await getProjectStateFingerprint(projectPath);
  const durationMs = performance.now() - startedAt;
  if (lastFingerprintRef) {
    const previousFingerprint = lastFingerprintRef.current;
    if (previousFingerprint?.fingerprint === nextFingerprint.fingerprint) {
      logPerf(
        "poll:project-state",
        durationMs,
        { source, result: "unchanged" },
        { slowThresholdMs: PROJECT_STATE_POLL_WARN_MS },
      );
      return;
    }
    if (previousFingerprint == null) {
      lastFingerprintRef.set(nextFingerprint);
      logPerf(
        "poll:project-state",
        durationMs,
        { source, result: "primed" },
        { slowThresholdMs: PROJECT_STATE_POLL_WARN_MS },
      );
      return;
    }
    lastFingerprintRef.set(nextFingerprint);
    logPerf(
      "poll:project-state",
      durationMs,
      {
        source,
        result: "changed",
        headChanged:
          previousFingerprint.headFingerprint !== nextFingerprint.headFingerprint,
        statusChanged:
          previousFingerprint.statusFingerprint !== nextFingerprint.statusFingerprint,
        activeCommit: Boolean(activeCommit),
      },
      { slowThresholdMs: PROJECT_STATE_POLL_WARN_MS },
    );
  }

  const queries: Promise<unknown>[] = [
    queryClient.invalidateQueries({ queryKey: ["repository", projectPath] }),
    queryClient.invalidateQueries({ queryKey: ["project-files", projectPath] }),
  ];

  if (!activeCommit) {
    queries.push(
      queryClient.invalidateQueries({
        queryKey: ["changed-files", projectPath, null],
      }),
    );
  }

  await Promise.all(queries);
}
