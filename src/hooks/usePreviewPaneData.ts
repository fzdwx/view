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
  getFileStatusDiff,
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
import { timeSync } from "../lib/performanceLog";
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
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly untracked: boolean;
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
  readonly fileStagedDiffQuery: UseQueryResult<LoadedWorktreeFileDiff, Error>;
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
    () =>
      timeSync(
        "preview:project-file-map",
        () => new Map(projectFiles.map((file) => [file.path, file])),
        { files: projectFiles.length },
      ),
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
  const selectedProjectStaged = selectedProjectFile?.staged === true;
  const selectedProjectUnstaged = selectedProjectFile?.unstaged === true;
  const selectedProjectUntracked = selectedProjectFile?.untracked === true;

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
      selectedProjectStaged,
      selectedProjectUnstaged,
      selectedProjectUntracked,
    ],
    queryFn: async () => {
      const rootPath = requireQueryInput(activeProjectPath, "worktree diff path");
      const filePath = requireQueryInput(selectedProjectPath, "worktree diff file");
      const status = requireQueryInput(selectedProjectStatus, "worktree status");
      return {
        rootPath,
        filePath,
        status,
        staged: selectedProjectStaged,
        unstaged: selectedProjectUnstaged,
        untracked: selectedProjectUntracked,
        diff: await getFileStatusDiff(rootPath, filePath, "worktree"),
      };
    },
    enabled:
      canLoadFilePreviewMetadata &&
      Boolean(
        selectedProjectStatus &&
          isChangedFileStatus(selectedProjectStatus) &&
          (selectedProjectUnstaged || selectedProjectUntracked),
      ),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const fileStagedDiffQuery = useQuery({
    queryKey: [
      "file-staged-diff",
      activeProjectPath,
      selectedProjectPath,
      selectedProjectStatus,
      selectedProjectStaged,
      selectedProjectUnstaged,
      selectedProjectUntracked,
    ],
    queryFn: async () => {
      const rootPath = requireQueryInput(activeProjectPath, "staged diff path");
      const filePath = requireQueryInput(selectedProjectPath, "staged diff file");
      const status = requireQueryInput(selectedProjectStatus, "staged status");
      return {
        rootPath,
        filePath,
        status,
        staged: selectedProjectStaged,
        unstaged: selectedProjectUnstaged,
        untracked: selectedProjectUntracked,
        diff: await getFileStatusDiff(rootPath, filePath, "staged"),
      };
    },
    enabled:
      canLoadFilePreviewMetadata &&
      Boolean(
        selectedProjectStatus &&
          isChangedFileStatus(selectedProjectStatus) &&
          selectedProjectStaged,
      ),
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
    fileWorktreeDiffQuery.data?.status === selectedProjectStatus &&
    fileWorktreeDiffQuery.data?.staged === selectedProjectStaged &&
    fileWorktreeDiffQuery.data?.unstaged === selectedProjectUnstaged &&
    fileWorktreeDiffQuery.data?.untracked === selectedProjectUntracked
      ? fileWorktreeDiffQuery.data.diff
      : "";
  const currentStagedFileDiff =
    fileStagedDiffQuery.data?.rootPath === activeProjectPath &&
    fileStagedDiffQuery.data?.filePath === selectedProjectPath &&
    fileStagedDiffQuery.data?.status === selectedProjectStatus &&
    fileStagedDiffQuery.data?.staged === selectedProjectStaged &&
    fileStagedDiffQuery.data?.unstaged === selectedProjectUnstaged &&
    fileStagedDiffQuery.data?.untracked === selectedProjectUntracked
      ? fileStagedDiffQuery.data.diff
      : "";
  const editorGitMarkers = useMemo(
    () =>
      timeSync(
        "preview:editor-git-markers",
        () => [
          ...buildEditorGitMarkers(currentWorktreeFileDiff, "worktree"),
          ...buildEditorGitMarkers(currentStagedFileDiff, "staged"),
        ],
        {
          stagedDiffChars: currentStagedFileDiff.length,
          worktreeDiffChars: currentWorktreeFileDiff.length,
        },
      ),
    [currentStagedFileDiff, currentWorktreeFileDiff],
  );
  const parsedDiff = useMemo(
    () =>
      timeSync(
        "preview:parse-diff",
        () => parseRepositoryDiff(currentFileDiff?.diff ?? ""),
        { diffChars: currentFileDiff?.diff.length ?? 0 },
      ),
    [currentFileDiff?.diff],
  );
  const visibleDiffFiles = useMemo(
    () =>
      timeSync(
        "preview:filter-diff-files",
        () => filterDiffFiles(parsedDiff.files, selectedChangePath),
        { files: parsedDiff.files.length, selected: selectedChangePath },
      ),
    [parsedDiff.files, selectedChangePath],
  );
  const diffStats = useMemo(
    () =>
      timeSync("preview:diff-stats", () => countDiffStats(visibleDiffFiles), {
        files: visibleDiffFiles.length,
      }),
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
    fileStagedDiffQuery,
    fileWorktreeDiffQuery,
    parsedDiff,
    selectedChangePath,
    selectedProjectFile,
    selectedProjectPath,
    visibleDiffFiles,
  };
}
