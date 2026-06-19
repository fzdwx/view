import {
  keepPreviousData,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  type CommitInfo,
  type FileBlameLine,
  type FileContent,
  type FileSearchResult,
  type GitStatus,
  type ReflogEntry,
  type RepositoryPayload,
  type TreeFile,
  getCommits,
  getFileBlame,
  getFileContent,
  getFileDiff,
  getProjectFiles,
  getReflog,
  loadRepository,
  searchFileContents,
  searchFileNames,
} from "../lib/api";
import type { CommandPanelMode } from "./useCommandPanel";
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

export interface LoadedFileBlame {
  readonly rootPath: string;
  readonly filePath: string;
  readonly lines: FileBlameLine[];
}

export interface RepositoryProjectDataOptions {
  readonly activeBranchRef: string | null;
  readonly activeCommit: string | null;
  readonly activeProjectPath: string | null;
  readonly commandMode: CommandPanelMode;
  readonly commandOpen: boolean;
  readonly commitFilter: string;
  readonly debouncedCommandQuery: string;
  readonly reflogFilter: string;
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
  readonly reflogEntries: ReflogEntry[];
  readonly reflogQuery: UseQueryResult<ReflogEntry[], Error>;
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
  readonly fileContentReady: boolean;
  readonly previewMode: PreviewMode;
  readonly selectedChangePath: string | null;
  readonly selectedProjectPath: string | null;
  readonly selectedProjectStatus: GitStatus | null;
}

export interface RepositoryPreviewData {
  readonly currentFileBlame: FileBlameLine[];
  readonly currentFileDiff: LoadedFileDiff | null;
  readonly currentWorktreeFileDiff: string;
  readonly diffStats: ReturnType<typeof countDiffStats>;
  readonly editorGitMarkers: EditorGitMarker[];
  readonly fileBlameQuery: UseQueryResult<LoadedFileBlame, Error>;
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
  reflogFilter,
  selectedProjectPath,
}: RepositoryProjectDataOptions): RepositoryProjectData {
  const [debouncedCommitFilter, setDebouncedCommitFilter] = useState("");
  const [debouncedReflogFilter, setDebouncedReflogFilter] = useState("");
  const [knownCommitsEntry, setKnownCommitsEntry] = useState<{
    forProject: string | null;
    commits: CommitInfo[];
  }>({ forProject: null, commits: [] });
  const knownCommits =
    knownCommitsEntry.forProject === activeProjectPath
      ? knownCommitsEntry.commits
      : [];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedCommitFilter(commitFilter.trim());
    }, 140);

    return () => window.clearTimeout(timer);
  }, [commitFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedReflogFilter(reflogFilter.trim());
    }, 140);

    return () => window.clearTimeout(timer);
  }, [reflogFilter]);

  // The whole query object is returned to consumers (App.tsx) that read many
  // fields (data/isFetching/isError/refetch/isPlaceholderData), so it must be
  // held as one value per the rule's own false-positive guidance.
  // oxlint-disable-next-line react-doctor/query-destructure-result
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

  // The whole query object is returned to consumers (App.tsx) that read many
  // fields (data/isFetching/isError/refetch/isPlaceholderData), so it must be
  // held as one value per the rule's own false-positive guidance.
  // oxlint-disable-next-line react-doctor/query-destructure-result
  const commitsQuery = useQuery({
    queryKey: [
      "commits",
      activeProjectPath,
      activeBranchRef,
      debouncedCommitFilter,
    ],
    queryFn: () =>
      getCommits(
        requireQueryInput(activeProjectPath, "commits path"),
        activeBranchRef,
        debouncedCommitFilter,
      ),
    enabled: Boolean(activeProjectPath),
    placeholderData: keepPreviousData,
    retry: false,
  });

  // The whole query object is returned to consumers (App.tsx) that read many
  // fields (data/isFetching/isError/refetch/isPlaceholderData), so it must be
  // held as one value per the rule's own false-positive guidance.
  // oxlint-disable-next-line react-doctor/query-destructure-result
  const reflogQuery = useQuery({
    queryKey: ["reflog", activeProjectPath, debouncedReflogFilter],
    queryFn: () =>
      getReflog(
        requireQueryInput(activeProjectPath, "reflog path"),
        debouncedReflogFilter,
      ),
    enabled: Boolean(activeProjectPath),
    placeholderData: keepPreviousData,
    retry: false,
  });

  // The whole query object is returned to consumers (App.tsx) that read many
  // fields (data/isFetching/isError/refetch/isPlaceholderData), so it must be
  // held as one value per the rule's own false-positive guidance.
  // oxlint-disable-next-line react-doctor/query-destructure-result
  const projectFilesQuery = useQuery({
    queryKey: ["project-files", activeProjectPath],
    queryFn: () =>
      getProjectFiles(requireQueryInput(activeProjectPath, "project files path")),
    enabled: Boolean(activeProjectPath),
    placeholderData: keepPreviousData,
    retry: false,
  });

  // The whole query object is returned to consumers (App.tsx) that read many
  // fields (data/isFetching/isError/refetch/isPlaceholderData), so it must be
  // held as one value per the rule's own false-positive guidance.
  // oxlint-disable-next-line react-doctor/query-destructure-result
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
  // The whole query object is returned to consumers (App.tsx) that read many
  // fields (data/isFetching/isError/refetch/isPlaceholderData), so it must be
  // held as one value per the rule's own false-positive guidance.
  // oxlint-disable-next-line react-doctor/query-destructure-result
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
  const filteredCommits = commitsQuery.data ?? payload?.commits ?? [];
  const reflogEntries = reflogQuery.data ?? [];
  const reflogCommits = useMemo(
    () => (reflogQuery.data ?? []).map(reflogEntryToCommitInfo),
    [reflogQuery.data],
  );
  const liveCommits = useMemo(
    () =>
      mergeCommitLists(
        commitsQuery.data ?? payload?.commits ?? [],
        reflogCommits,
        payload?.commits ?? [],
      ),
    [commitsQuery.data, payload?.commits, reflogCommits],
  );
  // knownCommitsEntry is an accumulated commit cache keyed by project; it
  // grows across renders and can't be derived from liveCommits alone.
  useEffect(() => {
    /* oxlint-disable react-doctor/no-derived-state */
    if (liveCommits.length === 0) {
      return;
    }

    setKnownCommitsEntry((entry) => {
      const current =
        entry.forProject === activeProjectPath ? entry.commits : [];
      const merged = mergeCommitLists(liveCommits, current);
      return merged.length === current.length
        ? { forProject: activeProjectPath, commits: current }
        : { forProject: activeProjectPath, commits: merged };
    });
    /* oxlint-enable react-doctor/no-derived-state */
  }, [activeProjectPath, liveCommits]);
  const commits = useMemo(
    () =>
      mergeCommitLists(
        liveCommits,
        knownCommitsEntry.forProject === activeProjectPath
          ? knownCommitsEntry.commits
          : [],
      ),
    [activeProjectPath, knownCommitsEntry, liveCommits],
  );
  const currentBranchRef =
    payload?.summary.branches.find((branch) => branch.current)?.refName ?? null;
  const selectedBranchRef = activeBranchRef ?? currentBranchRef;
  const selectedBranch =
    payload?.summary.branches.find(
      (branch) => branch.refName === selectedBranchRef,
    ) ?? null;
  const selectedCommit = useMemo(
    () =>
      activeCommit
        ? commits.find((commit) => commit.hash === activeCommit) ?? null
        : null,
    [activeCommit, commits],
  );
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
    reflogEntries,
    reflogQuery,
    repositoryQuery,
    selectedBranch,
    selectedBranchRef,
    selectedCommit,
    selectedProjectFile,
    selectedProjectStatus,
  };
}

function mergeCommitLists(
  ...lists: readonly (readonly CommitInfo[])[]
): CommitInfo[] {
  const seen = new Set<string>();
  const merged: CommitInfo[] = [];

  for (const list of lists) {
    for (const commit of list) {
      if (seen.has(commit.hash)) {
        continue;
      }

      seen.add(commit.hash);
      merged.push(commit);
    }
  }

  return merged;
}

function reflogEntryToCommitInfo(entry: ReflogEntry): CommitInfo {
  return {
    hash: entry.hash,
    shortHash: entry.shortHash,
    parents: [],
    author: entry.author,
    date: entry.date,
    subject: entry.subject || entry.action,
  };
}

export function useRepositoryPreviewData({
  activeCommit,
  activeProjectPath,
  fileContentReady,
  previewMode,
  selectedChangePath,
  selectedProjectPath,
  selectedProjectStatus,
}: RepositoryPreviewDataOptions): RepositoryPreviewData {
  const canLoadFilePreviewMetadata = Boolean(
    activeProjectPath &&
      selectedProjectPath &&
      previewMode === "file" &&
      fileContentReady,
  );
  // The whole query object is returned to consumers (App.tsx) that read many
  // fields (data/isFetching/isError/refetch/isPlaceholderData), so it must be
  // held as one value per the rule's own false-positive guidance.
  // oxlint-disable-next-line react-doctor/query-destructure-result
  const fileBlameQuery = useQuery({
    queryKey: ["file-blame", activeProjectPath, selectedProjectPath],
    queryFn: async () => {
      const rootPath = requireQueryInput(activeProjectPath, "file blame path");
      const filePath = requireQueryInput(
        selectedProjectPath,
        "file blame file path",
      );

      return {
        rootPath,
        filePath,
        lines: await getFileBlame(rootPath, filePath),
      };
    },
    enabled: canLoadFilePreviewMetadata,
    placeholderData: keepPreviousData,
    retry: false,
  });

  // The whole query object is returned to consumers (App.tsx) that read many
  // fields (data/isFetching/isError/refetch/isPlaceholderData), so it must be
  // held as one value per the rule's own false-positive guidance.
  // oxlint-disable-next-line react-doctor/query-destructure-result
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

  // The whole query object is returned to consumers (App.tsx) that read many
  // fields (data/isFetching/isError/refetch/isPlaceholderData), so it must be
  // held as one value per the rule's own false-positive guidance.
  // oxlint-disable-next-line react-doctor/query-destructure-result
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
    enabled:
      canLoadFilePreviewMetadata &&
      Boolean(
        selectedProjectStatus && isChangedFileStatus(selectedProjectStatus),
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
  const currentFileBlame =
    fileBlameQuery.data?.rootPath === activeProjectPath &&
    fileBlameQuery.data?.filePath === selectedProjectPath
      ? fileBlameQuery.data.lines
      : [];
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
    currentFileDiff,
    currentWorktreeFileDiff,
    diffStats,
    editorGitMarkers,
    fileBlameQuery,
    fileDiffQuery,
    fileWorktreeDiffQuery,
    parsedDiff,
    visibleDiffFiles,
  };
}
