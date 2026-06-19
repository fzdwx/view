import { useEffect, useRef } from "react";
import { fetchRemotes, isTauriRuntime } from "../lib/api";

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

    const refreshRemoteRefs = async () => {
      if (remoteFetchInFlightRef.current) {
        return;
      }

      remoteFetchInFlightRef.current = true;
      try {
        await fetchRemotes(activeProjectPath);
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

    const timer = window.setInterval(() => {
      void refreshRemoteRefs();
    }, 120_000);

    return () => window.clearInterval(timer);
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
