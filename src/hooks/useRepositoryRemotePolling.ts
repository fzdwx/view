import { useEffect, useRef } from "react";
import { fetchRemotes, isTauriRuntime } from "../lib/api";
import {
  isPanelResizeInProgress,
  panelResizeEndEvent,
} from "../lib/panelResizeInteraction";

type RefetchRepositoryData = () => Promise<unknown>;

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
        if (isPanelResizeInProgress()) {
          pendingResizeRefresh = true;
          return;
        }
        await Promise.all([
          refetchRepository(),
          refetchCommits(),
          refetchProjectFiles(),
        ]);
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
      void refreshRemoteRefs();
    };

    const timer = window.setInterval(() => {
      void refreshRemoteRefs();
    }, 120_000);
    window.addEventListener(panelResizeEndEvent, refreshAfterPanelResize);

    return () => {
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
