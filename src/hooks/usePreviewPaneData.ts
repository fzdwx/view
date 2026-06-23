import {
  keepPreviousData,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useMemo } from "react";
import {
  type FileBlameLine,
  type FileContent,
  type GitStatus,
  type TreeFile,
  getFileBlame,
  getFileContent,
  getFileDiff,
} from "../lib/api";
import {
  countDiffStats,
  filterDiffFiles,
  parseRepositoryDiff,
  type ParsedRepositoryDiff,
} from "../lib/diff";
import { buildEditorGitMarkers } from "../lib/editorGitMarkers";
import type { EditorGitMarker } from "../lib/editorTypes";
import { isChangedFileStatus } from "../lib/gitStatus";
import { activePreviewPaneTab, type PreviewPane } from "../lib/previewPanes";
import { requireQueryInput } from "../lib/queryInput";

interface LoadedFileContent {
  readonly rootPath: string;
  readonly filePath: string;
  readonly file: FileContent;
}

interface LoadedFileDiff {
  readonly rootPath: string;
  readonly commit: string | null;
  readonly filePath: string;
  readonly diff: string;
}

interface LoadedWorktreeFileDiff {
  readonly rootPath: string;
  readonly filePath: string;
  readonly status: GitStatus;
  readonly diff: string;
}

interface LoadedFileBlame {
  readonly rootPath: string;
  readonly filePath: string;
  readonly lines: FileBlameLine[];
}

export interface PreviewPaneData {
  readonly currentFileBlame: FileBlameLine[];
  readonly currentFileContent: FileContent | null;
  readonly currentFileDiff: LoadedFileDiff | null;
  readonly diffStats: ReturnType<typeof countDiffStats>;
  readonly editorGitMarkers: EditorGitMarker[];
  readonly fileBlameQuery: UseQueryResult<LoadedFileBlame, Error>;
  readonly fileContentQuery: UseQueryResult<LoadedFileContent, Error>;
  readonly fileDiffQuery: UseQueryResult<LoadedFileDiff, Error>;
  readonly fileWorktreeDiffQuery: UseQueryResult<LoadedWorktreeFileDiff, Error>;
  readonly parsedDiff: ParsedRepositoryDiff;
  readonly selectedChangePath: string | null;
  readonly selectedProjectFile: TreeFile | null;
  readonly selectedProjectPath: string | null;
  readonly visibleDiffFiles: ParsedRepositoryDiff["files"];
}

export function usePreviewPaneData({
  activeCommit,
  activeProjectPath,
  hasGitRepository,
  pane,
  projectFiles,
}: {
  readonly activeCommit: string | null;
  readonly activeProjectPath: string | null;
  readonly hasGitRepository: boolean;
  readonly pane: PreviewPane;
  readonly projectFiles: readonly TreeFile[];
}): PreviewPaneData {
  const tab = activePreviewPaneTab(pane);
  const selectedProjectPath = tab?.mode === "file" ? tab.path : null;
  const selectedChangePath = tab?.mode === "diff" ? tab.path : null;
  const projectFileByPath = useMemo(
    () => new Map(projectFiles.map((file) => [file.path, file])),
    [projectFiles],
  );
  const selectedProjectFile = useMemo(
    () =>
      selectedProjectPath
        ? projectFileByPath.get(selectedProjectPath) ?? null
        : null,
    [projectFileByPath, selectedProjectPath],
  );
  const selectedProjectStatus = selectedProjectFile?.status ?? null;

  const fileContentQuery = useQuery({
    queryKey: ["file-content", activeProjectPath, selectedProjectPath],
    queryFn: async () => {
      const rootPath = requireQueryInput(activeProjectPath, "file content path");
      const filePath = requireQueryInput(
        selectedProjectPath,
        "file content file path",
      );
      return { rootPath, filePath, file: await getFileContent(rootPath, filePath) };
    },
    enabled: Boolean(activeProjectPath && selectedProjectPath),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const currentFileContent =
    fileContentQuery.data?.rootPath === activeProjectPath &&
    fileContentQuery.data?.filePath === selectedProjectPath
      ? fileContentQuery.data.file
      : null;
  const canLoadFilePreviewMetadata = Boolean(
    hasGitRepository &&
      activeProjectPath &&
      selectedProjectPath &&
      pane.mode === "file" &&
      currentFileContent,
  );

  const fileBlameQuery = useQuery({
    queryKey: ["file-blame", activeProjectPath, selectedProjectPath],
    queryFn: async () => {
      const rootPath = requireQueryInput(activeProjectPath, "file blame path");
      const filePath = requireQueryInput(
        selectedProjectPath,
        "file blame file path",
      );
      return { rootPath, filePath, lines: await getFileBlame(rootPath, filePath) };
    },
    enabled: canLoadFilePreviewMetadata,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const fileDiffQuery = useQuery({
    queryKey: ["file-diff", activeProjectPath, activeCommit, selectedChangePath],
    queryFn: async () => {
      const rootPath = requireQueryInput(activeProjectPath, "file diff path");
      const commit = activeCommit ?? null;
      const filePath = requireQueryInput(selectedChangePath, "file diff file path");
      return { rootPath, commit, filePath, diff: await getFileDiff(rootPath, filePath, commit) };
    },
    enabled: Boolean(
      hasGitRepository &&
        activeProjectPath &&
        selectedChangePath &&
        pane.mode === "diff",
    ),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const fileWorktreeDiffQuery = useQuery({
    queryKey: [
      "file-worktree-diff",
      activeProjectPath,
      selectedProjectPath,
      selectedProjectStatus,
    ],
    queryFn: async () => {
      const rootPath = requireQueryInput(activeProjectPath, "worktree diff path");
      const filePath = requireQueryInput(selectedProjectPath, "worktree diff file");
      const status = requireQueryInput(selectedProjectStatus, "worktree status");
      return { rootPath, filePath, status, diff: await getFileDiff(rootPath, filePath, null) };
    },
    enabled:
      canLoadFilePreviewMetadata &&
      Boolean(selectedProjectStatus && isChangedFileStatus(selectedProjectStatus)),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const currentFileBlame =
    fileBlameQuery.data?.rootPath === activeProjectPath &&
    fileBlameQuery.data?.filePath === selectedProjectPath
      ? fileBlameQuery.data.lines
      : [];
  const currentFileDiff =
    fileDiffQuery.data?.rootPath === activeProjectPath &&
    fileDiffQuery.data?.commit === (activeCommit ?? null) &&
    fileDiffQuery.data?.filePath === selectedChangePath
      ? fileDiffQuery.data
      : null;
  const currentWorktreeFileDiff =
    fileWorktreeDiffQuery.data?.rootPath === activeProjectPath &&
    fileWorktreeDiffQuery.data?.filePath === selectedProjectPath &&
    fileWorktreeDiffQuery.data?.status === selectedProjectStatus
      ? fileWorktreeDiffQuery.data.diff
      : "";
  const editorGitMarkers = useMemo(
    () => buildEditorGitMarkers(currentWorktreeFileDiff),
    [currentWorktreeFileDiff],
  );
  const parsedDiff = useMemo(
    () => parseRepositoryDiff(currentFileDiff?.diff ?? ""),
    [currentFileDiff?.diff],
  );
  const visibleDiffFiles = useMemo(
    () => filterDiffFiles(parsedDiff.files, selectedChangePath),
    [parsedDiff.files, selectedChangePath],
  );
  const diffStats = useMemo(
    () => countDiffStats(visibleDiffFiles),
    [visibleDiffFiles],
  );

  return {
    currentFileBlame,
    currentFileContent,
    currentFileDiff,
    diffStats,
    editorGitMarkers,
    fileBlameQuery,
    fileContentQuery,
    fileDiffQuery,
    fileWorktreeDiffQuery,
    parsedDiff,
    selectedChangePath,
    selectedProjectFile,
    selectedProjectPath,
    visibleDiffFiles,
  };
}
