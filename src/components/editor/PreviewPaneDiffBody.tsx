import { DiffPanel } from "../DiffPanel";
import type { GitAvailability } from "../workbench/GitPanels";
import type { usePreviewPaneData } from "../../hooks/usePreviewPaneData";
import { PaneEmpty, PaneLoading } from "./PreviewPaneStates";

export function PreviewPaneDiffBody({
  activeCommit,
  activeProjectPath,
  data,
  gitAvailability,
  hasGitRepository,
  repositoryReady,
}: {
  readonly activeCommit: string | null;
  readonly activeProjectPath: string | null;
  readonly data: ReturnType<typeof usePreviewPaneData>;
  readonly gitAvailability: GitAvailability;
  readonly hasGitRepository: boolean;
  readonly repositoryReady: boolean;
}) {
  if (gitAvailability === "loading") {
    return <PaneLoading />;
  }
  if (!hasGitRepository) {
    return (
      <PaneEmpty
        title="Git Diff Unavailable"
        copy="This folder is not inside a Git repository."
      />
    );
  }
  if (repositoryReady && !data.selectedChangePath) {
    return (
      <PaneEmpty
        title="Select a changed file"
        copy="Choose a file from Changes to render its diff."
      />
    );
  }
  if (repositoryReady && data.fileDiffQuery.isFetching && !data.currentFileDiff) {
    return <PaneLoading />;
  }
  if (repositoryReady) {
    return (
      <DiffPanel
        error={
          data.parsedDiff.error ??
          (data.fileDiffQuery.isError
            ? String(data.fileDiffQuery.error.message)
            : null)
        }
        files={data.visibleDiffFiles}
        title={data.selectedChangePath ?? "Repository diff"}
        projectPath={activeProjectPath}
        commit={activeCommit}
      />
    );
  }
  return <PaneLoading />;
}
