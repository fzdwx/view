import type { usePreviewPaneData } from "../../hooks/usePreviewPaneData";

export function paneLoading(
  repositoryLoading: boolean,
  data: ReturnType<typeof usePreviewPaneData>,
): boolean {
  return (
    repositoryLoading ||
    data.fileContentQuery.isFetching ||
    data.fileStagedDiffQuery.isFetching ||
    data.fileDiffQuery.isFetching ||
    data.fileWorktreeDiffQuery.isFetching
  );
}
