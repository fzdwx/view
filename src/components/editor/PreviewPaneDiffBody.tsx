import { Loader2 } from "lucide-react";
import { DiffPanel } from "../DiffPanel";
import type { GitAvailability } from "../workbench/GitPanels";
import type { usePreviewPaneData } from "../../hooks/usePreviewPaneData";

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

export function PaneLoading() {
  return (
    <div className="diff-loading">
      <Loader2 className="spin" size={18} />
    </div>
  );
}

export function PaneEmpty({
  title,
  copy,
}: {
  readonly title: string;
  readonly copy: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-title">{title}</div>
      <div className="empty-copy">{copy}</div>
    </div>
  );
}

export function paneLoading(
  repositoryLoading: boolean,
  data: ReturnType<typeof usePreviewPaneData>,
): boolean {
  return (
    repositoryLoading ||
    data.fileContentQuery.isFetching ||
    data.fileDiffQuery.isFetching ||
    data.fileWorktreeDiffQuery.isFetching
  );
}
