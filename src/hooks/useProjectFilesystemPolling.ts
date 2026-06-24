import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  getProjectStateFingerprint,
  isTauriRuntime,
  type ProjectStateFingerprint,
} from "../lib/api";
import {
  isPanelResizeInProgress,
  panelResizeEndEvent,
  runAfterPanelResizeIdle,
  type PanelResizeIdleTaskHandle,
} from "../lib/panelResizeInteraction";
import { logPerf } from "../lib/performanceLog";

const PROJECT_STATE_POLL_INTERVAL_MS = 5000;
const PROJECT_STATE_POLL_WARN_MS = 100;
const BACKGROUND_INVALIDATION_AFTER_RESIZE_DELAY_MS = 320;

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
    let pendingResizeRefresh: ProjectStatePollSource | null = null;
    let pendingResizeRefreshHandle: PanelResizeIdleTaskHandle | null = null;

    function refresh(source: ProjectStatePollSource): void {
      if (isPanelResizeInProgress()) {
        pendingResizeRefresh = source;
        logPerf("poll:project-state", 0, {
          source,
          result: "deferred-panel-resize",
        });
        return;
      }
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
        (result) => {
          if (result === "deferred-panel-resize") {
            pendingResizeRefresh = source;
          }
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
    const refreshAfterPanelResize = () => {
      if (!pendingResizeRefresh) {
        return;
      }
      const source = pendingResizeRefresh;
      pendingResizeRefresh = null;
      pendingResizeRefreshHandle?.cancel();
      pendingResizeRefreshHandle = runAfterPanelResizeIdle(
        () => {
          pendingResizeRefreshHandle = null;
          refresh(source);
        },
        {
          delayMs: BACKGROUND_INVALIDATION_AFTER_RESIZE_DELAY_MS,
          idleTimeoutMs: 1_000,
          timeoutMs: 80,
        },
      );
    };
    refresh("initial");
    window.addEventListener("focus", refreshFromFocus);
    window.addEventListener(panelResizeEndEvent, refreshAfterPanelResize);
    const pollingTimer = window.setInterval(
      () => refresh("interval"),
      PROJECT_STATE_POLL_INTERVAL_MS,
    );

    return () => {
      pendingResizeRefreshHandle?.cancel();
      window.clearInterval(pollingTimer);
      window.removeEventListener("focus", refreshFromFocus);
      window.removeEventListener(panelResizeEndEvent, refreshAfterPanelResize);
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
): Promise<"applied" | "deferred-panel-resize" | "primed" | "unchanged"> {
  const startedAt = performance.now();
  const nextFingerprint = await getProjectStateFingerprint(projectPath);
  const durationMs = performance.now() - startedAt;
  let headChanged = true;
  let summaryChanged = true;
  let statusChanged = true;
  if (lastFingerprintRef) {
    const previousFingerprint = lastFingerprintRef.current;
    if (previousFingerprint?.fingerprint === nextFingerprint.fingerprint) {
      logPerf(
        "poll:project-state",
        durationMs,
        { source, result: "unchanged" },
        { slowThresholdMs: PROJECT_STATE_POLL_WARN_MS },
      );
      return "unchanged";
    }
    if (previousFingerprint == null) {
      lastFingerprintRef.set(nextFingerprint);
      logPerf(
        "poll:project-state",
        durationMs,
        { source, result: "primed" },
        { slowThresholdMs: PROJECT_STATE_POLL_WARN_MS },
      );
      return "primed";
    }
    if (isPanelResizeInProgress()) {
      logPerf(
        "poll:project-state",
        durationMs,
        { source, result: "deferred-panel-resize-after-fingerprint" },
        { slowThresholdMs: PROJECT_STATE_POLL_WARN_MS },
      );
      return "deferred-panel-resize";
    }
    headChanged =
      previousFingerprint.headFingerprint !== nextFingerprint.headFingerprint;
    summaryChanged =
      previousFingerprint.summaryFingerprint !==
      nextFingerprint.summaryFingerprint;
    statusChanged =
      previousFingerprint.statusFingerprint !== nextFingerprint.statusFingerprint;
    lastFingerprintRef.set(nextFingerprint);
    logPerf(
      "poll:project-state",
      durationMs,
      {
        source,
        result: "changed",
        headChanged,
        summaryChanged,
        statusChanged,
        activeCommit: Boolean(activeCommit),
      },
      { slowThresholdMs: PROJECT_STATE_POLL_WARN_MS },
    );
  }

  const invalidations: Array<() => Promise<unknown>> = [];

  if (headChanged || summaryChanged) {
    invalidations.push(
      () => queryClient.invalidateQueries({ queryKey: ["repository", projectPath] }),
    );
  }

  if (headChanged || statusChanged) {
    invalidations.push(
      () => queryClient.invalidateQueries({ queryKey: ["project-files", projectPath] }),
    );
  }

  if (!activeCommit && (headChanged || statusChanged)) {
    invalidations.push(
      () => queryClient.invalidateQueries({
        queryKey: ["changed-files", projectPath, null],
      }),
    );
  }

  if (invalidations.length > 0) {
    await runBackgroundInvalidationsAfterResizeIdle(invalidations);
  }
  return "applied";
}

function runBackgroundInvalidationsAfterResizeIdle(
  invalidations: readonly (() => Promise<unknown>)[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    runAfterPanelResizeIdle(
      () => {
        void Promise.all(invalidations.map((invalidate) => invalidate())).then(
          () => resolve(),
          (error: unknown) => reject(error),
        );
      },
      {
        delayMs: BACKGROUND_INVALIDATION_AFTER_RESIZE_DELAY_MS,
        idleTimeoutMs: 1_000,
        timeoutMs: 80,
      },
    );
  });
}
