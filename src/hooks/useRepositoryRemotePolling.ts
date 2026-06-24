import { useEffect, useRef } from "react";
import { fetchRemotes, isTauriRuntime } from "../lib/api";
import {
  isPanelResizeInProgress,
  panelResizeEndEvent,
  runAfterPanelResizeIdle,
  type PanelResizeIdleTaskHandle,
} from "../lib/panelResizeInteraction";

type RefetchRepositoryData = () => Promise<unknown>;
const REMOTE_REFETCH_AFTER_RESIZE_DELAY_MS = 420;

export interface UseRepositoryRemotePollingOptions {
  readonly activeProjectPath: string | null;
  readonly hasGitRepository: boolean;
  readonly refetchCommits: RefetchRepositoryData;
  readonly refetchProjectFiles: RefetchRepositoryData;
  readonly refetchRepository: RefetchRepositoryData;
}

export function useRepositoryRemotePolling({
  activeProjectPath,
  hasGitRepository,
  refetchCommits,
  refetchProjectFiles,
  refetchRepository,
}: UseRepositoryRemotePollingOptions): void {
  const remoteFetchInFlightRef = useRef(false);

  useEffect(() => {
    if (!activeProjectPath || !hasGitRepository || !isTauriRuntime()) {
      return;
    }

    let pendingResizeRefresh = false;
    let scheduledRefetch: PanelResizeIdleTaskHandle | null = null;
    let scheduledRemoteFetch: PanelResizeIdleTaskHandle | null = null;
    const scheduleRepositoryRefetch = () => {
      scheduledRefetch?.cancel();
      scheduledRefetch = runAfterPanelResizeIdle(
        () => {
          scheduledRefetch = null;
          void Promise.all([
            refetchRepository(),
            refetchCommits(),
            refetchProjectFiles(),
          ]).catch(reportRemoteRefreshError);
        },
        {
          delayMs: REMOTE_REFETCH_AFTER_RESIZE_DELAY_MS,
          idleTimeoutMs: 1_000,
          timeoutMs: 80,
        },
      );
    };
    const refreshRemoteRefs = async () => {
      if (isPanelResizeInProgress()) {
        pendingResizeRefresh = true;
        return;
      }
      if (remoteFetchInFlightRef.current) {
        return;
      }

      remoteFetchInFlightRef.current = true;
      try {
        await fetchRemotes(activeProjectPath);
        scheduleRepositoryRefetch();
      } catch (error) {
        reportRemoteRefreshError(error);
      } finally {
        remoteFetchInFlightRef.current = false;
      }
    };
    const refreshAfterPanelResize = () => {
      if (!pendingResizeRefresh) {
        return;
      }
      pendingResizeRefresh = false;
      scheduledRemoteFetch?.cancel();
      scheduledRemoteFetch = runAfterPanelResizeIdle(
        () => {
          scheduledRemoteFetch = null;
          void refreshRemoteRefs();
        },
        {
          delayMs: REMOTE_REFETCH_AFTER_RESIZE_DELAY_MS,
          idleTimeoutMs: 1_000,
          timeoutMs: 80,
        },
      );
    };

    const timer = window.setInterval(() => {
      void refreshRemoteRefs();
    }, 120_000);
    window.addEventListener(panelResizeEndEvent, refreshAfterPanelResize);

    return () => {
      scheduledRemoteFetch?.cancel();
      scheduledRefetch?.cancel();
      window.clearInterval(timer);
      window.removeEventListener(panelResizeEndEvent, refreshAfterPanelResize);
    };
  }, [
    activeProjectPath,
    hasGitRepository,
    refetchCommits,
    refetchProjectFiles,
    refetchRepository,
  ]);
}

function reportRemoteRefreshError(error: unknown): void {
  if (error instanceof Error) {
    console.warn("Failed to fetch remotes", error.message);
    return;
  }

  console.warn("Failed to fetch remotes", String(error));
}
