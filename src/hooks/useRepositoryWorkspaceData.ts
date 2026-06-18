import {
  keepPreviousData,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useMemo } from "react";
import {
  type CommitInfo,
  type FileContent,
  type FileSearchResult,
  type GitStatus,
  type RepositoryPayload,
  type TreeFile,
  getCommits,
  getFileContent,
  getFileDiff,
  getProjectFiles,
  loadRepository,
  searchFileContents,
  searchFileNames,
} from "../lib/api";
import type { CommandPanelMode } from "./useCommandPanel";
import { filterCommits } from "../lib/commitFilters";
import {
  countDiffStats,
  filterDiffFiles,
  parseRepositoryDiff,
  type ParsedRepositoryDiff,
} from "../lib/diff";
import { buildEditorGitMarkers } from "../lib/editorGitMarkers";
import type { EditorGitMarker } from "../lib/editorTypes";
import { isChangedFileStatus } from "../lib/gitStatus";
import type { PreviewMode } from "../lib/previewTabs";
import { requireQueryInput } from "../lib/queryInput";

export interface LoadedFileContent {
  readonly rootPath: string;
  readonly filePath: string;
  readonly file: FileContent;
}

export interface LoadedFileDiff {
  readonly rootPath: string;
  readonly commit: string | null;
  readonly filePath: string;
  readonly diff: string;
}

export interface LoadedWorktreeFileDiff {
  readonly rootPath: string;
  readonly filePath: string;
  readonly status: GitStatus;
  readonly diff: string;
}

export interface RepositoryProjectDataOptions {
  readonly activeBranchRef: string | null;
  readonly activeCommit: string | null;
  readonly activeProjectPath: string | null;
  readonly commandMode: CommandPanelMode;
  readonly commandOpen: boolean;
  readonly commitFilter: string;
  readonly debouncedCommandQuery: string;
  readonly selectedProjectPath: string | null;
}

export interface RepositoryProjectData {
  readonly commandResults: FileSearchResult[];
  readonly commits: CommitInfo[];
  readonly commitsQuery: UseQueryResult<CommitInfo[], Error>;
  readonly currentBranchRef: string | null;
  readonly currentFileContent: FileContent | null;
  readonly fileContentQuery: UseQueryResult<LoadedFileContent, Error>;
  readonly fileSearchQuery: UseQueryResult<FileSearchResult[], Error>;
  readonly filteredCommits: CommitInfo[];
  readonly payload: RepositoryPayload | undefined;
  readonly projectFilesQuery: UseQueryResult<TreeFile[], Error>;
  readonly repositoryQuery: UseQueryResult<RepositoryPayload, Error>;
  readonly selectedBranch: RepositoryPayload["summary"]["branches"][number] | null;
  readonly selectedBranchRef: string | null;
  readonly selectedCommit: CommitInfo | null;
  readonly selectedProjectFile: TreeFile | null;
  readonly selectedProjectStatus: GitStatus | null;
}

export interface RepositoryPreviewDataOptions {
  readonly activeCommit: string | null;
  readonly activeProjectPath: string | null;
  readonly previewMode: PreviewMode;
  readonly selectedChangePath: string | null;
  readonly selectedProjectPath: string | null;
  readonly selectedProjectStatus: GitStatus | null;
}

export interface RepositoryPreviewData {
  readonly currentFileDiff: LoadedFileDiff | null;
  readonly currentWorktreeFileDiff: string;
  readonly diffStats: ReturnType<typeof countDiffStats>;
  readonly editorGitMarkers: EditorGitMarker[];
  readonly fileDiffQuery: UseQueryResult<LoadedFileDiff, Error>;
  readonly fileWorktreeDiffQuery: UseQueryResult<LoadedWorktreeFileDiff, Error>;
  readonly parsedDiff: ParsedRepositoryDiff;
  readonly visibleDiffFiles: ParsedRepositoryDiff["files"];
}

export function useRepositoryProjectData({
  activeBranchRef,
  activeCommit,
  activeProjectPath,
  commandMode,
  commandOpen,
  commitFilter,
  debouncedCommandQuery,
  selectedProjectPath,
}: RepositoryProjectDataOptions): RepositoryProjectData {
  const repositoryQuery = useQuery({
    queryKey: ["repository", activeProjectPath, activeCommit],
    queryFn: () =>
      loadRepository(
        requireQueryInput(activeProjectPath, "repository path"),
        activeCommit,
        null,
      ),
    enabled: Boolean(activeProjectPath),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const commitsQuery = useQuery({
    queryKey: ["commits", activeProjectPath, activeBranchRef],
    queryFn: () =>
      getCommits(
        requireQueryInput(activeProjectPath, "commits path"),
        activeBranchRef,
      ),
    enabled: Boolean(activeProjectPath),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const projectFilesQuery = useQuery({
    queryKey: ["project-files", activeProjectPath],
    queryFn: () =>
      getProjectFiles(requireQueryInput(activeProjectPath, "project files path")),
    enabled: Boolean(activeProjectPath),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const fileContentQuery = useQuery({
    queryKey: ["file-content", activeProjectPath, selectedProjectPath],
    queryFn: async () => {
      const rootPath = requireQueryInput(
        activeProjectPath,
        "file content path",
      );
      const filePath = requireQueryInput(
        selectedProjectPath,
        "file content file path",
      );

      return {
        rootPath,
        filePath,
        file: await getFileContent(rootPath, filePath),
      };
    },
    enabled: Boolean(activeProjectPath && selectedProjectPath),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const searchFn = commandMode === "content" ? searchFileContents : searchFileNames;
  const fileSearchQuery = useQuery({
    queryKey: ["file-search", commandMode, activeProjectPath, debouncedCommandQuery],
    queryFn: () =>
      searchFn(
        requireQueryInput(activeProjectPath, "file search path"),
        debouncedCommandQuery,
        80,
      ),
    enabled: Boolean(
      activeProjectPath && commandOpen && debouncedCommandQuery.trim(),
    ),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const payload = repositoryQuery.data;
  const currentFileContent =
    fileContentQuery.data?.rootPath === activeProjectPath &&
    fileContentQuery.data?.filePath === selectedProjectPath
      ? fileContentQuery.data.file
      : null;
  const selectedProjectFile = useMemo(
    () =>
      (projectFilesQuery.data ?? repositoryQuery.data?.files ?? []).find(
        (file) => file.path === selectedProjectPath,
      ) ?? null,
    [projectFilesQuery.data, repositoryQuery.data?.files, selectedProjectPath],
  );
  const selectedProjectStatus = selectedProjectFile?.status ?? null;
  const commits = commitsQuery.data ?? payload?.commits ?? [];
  const filteredCommits = useMemo(
    () => filterCommits(commits, commitFilter),
    [commits, commitFilter],
  );
  const currentBranchRef =
    payload?.summary.branches.find((branch) => branch.current)?.refName ?? null;
  const selectedBranchRef = activeBranchRef ?? currentBranchRef;
  const selectedBranch =
    payload?.summary.branches.find(
      (branch) => branch.refName === selectedBranchRef,
    ) ?? null;
  const selectedCommit =
    commits.find((commit) => commit.hash === activeCommit) ?? null;
  const commandResults =
    debouncedCommandQuery.trim().length > 0
      ? (fileSearchQuery.data ?? [])
      : [];

  return {
    commandResults,
    commits,
    commitsQuery,
    currentBranchRef,
    currentFileContent,
    fileContentQuery,
    fileSearchQuery,
    filteredCommits,
    payload,
    projectFilesQuery,
    repositoryQuery,
    selectedBranch,
    selectedBranchRef,
    selectedCommit,
    selectedProjectFile,
    selectedProjectStatus,
  };
}

export function useRepositoryPreviewData({
  activeCommit,
  activeProjectPath,
  previewMode,
  selectedChangePath,
  selectedProjectPath,
  selectedProjectStatus,
}: RepositoryPreviewDataOptions): RepositoryPreviewData {
  const fileDiffQuery = useQuery({
    queryKey: [
      "file-diff",
      activeProjectPath,
      activeCommit,
      selectedChangePath,
    ],
    queryFn: async () => {
      const rootPath = requireQueryInput(activeProjectPath, "file diff path");
      const commit = activeCommit ?? null;
      const filePath = requireQueryInput(
        selectedChangePath,
        "file diff file path",
      );

      return {
        rootPath,
        commit,
        filePath,
        diff: await getFileDiff(rootPath, filePath, commit),
      };
    },
    enabled: Boolean(
      activeProjectPath && selectedChangePath && previewMode === "diff",
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
      const rootPath = requireQueryInput(
        activeProjectPath,
        "file worktree diff path",
      );
      const filePath = requireQueryInput(
        selectedProjectPath,
        "file worktree diff file path",
      );
      const status = requireQueryInput(
        selectedProjectStatus,
        "file worktree diff status",
      );

      return {
        rootPath,
        filePath,
        status,
        diff: await getFileDiff(rootPath, filePath, null),
      };
    },
    enabled: Boolean(
      activeProjectPath &&
        selectedProjectPath &&
        previewMode === "file" &&
        selectedProjectStatus &&
        isChangedFileStatus(selectedProjectStatus),
    ),
    placeholderData: keepPreviousData,
    retry: false,
  });

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
    currentFileDiff,
    currentWorktreeFileDiff,
    diffStats,
    editorGitMarkers,
    fileDiffQuery,
    fileWorktreeDiffQuery,
    parsedDiff,
    visibleDiffFiles,
  };
}
