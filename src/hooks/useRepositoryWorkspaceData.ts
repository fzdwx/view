import {
  keepPreviousData,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type CommitInfo,
  type FileSearchResult,
  type GitStatus,
  type ReflogEntry,
  type RepositoryPayload,
  type TreeFile,
  getChangedFiles,
  getCommits,
  getProjectFiles,
  getReflog,
  loadRepository,
  searchFileContents,
  searchFileNames,
  searchSymbolReferences,
} from "../lib/api";
import type { CommandPanelMode } from "./useCommandPanel";
import { requireQueryInput } from "../lib/queryInput";
import { treeFilesSignature } from "../lib/treeFileIdentity";

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
  readonly changedFiles: TreeFile[];
  readonly changedFilesQuery: UseQueryResult<TreeFile[], Error>;
  readonly commandResults: FileSearchResult[];
  readonly commits: CommitInfo[];
  readonly commitsQuery: UseQueryResult<CommitInfo[], Error>;
  readonly currentBranchRef: string | null;
  readonly fileSearchQuery: UseQueryResult<FileSearchResult[], Error>;
  readonly filteredCommits: CommitInfo[];
  readonly payload: RepositoryPayload | undefined;
  readonly projectFiles: TreeFile[] | undefined;
  readonly projectFilesQuery: UseQueryResult<TreeFile[], Error>;
  readonly reflogEntries: ReflogEntry[];
  readonly reflogQuery: UseQueryResult<ReflogEntry[], Error>;
  readonly repositoryQuery: UseQueryResult<RepositoryPayload, Error>;
  readonly selectedBranch: RepositoryPayload["summary"]["branches"][number] | null;
  readonly selectedBranchRef: string | null;
  readonly selectedCommit: CommitInfo | null;
  readonly selectedProjectFile: TreeFile | null;
  readonly selectedProjectStatus: GitStatus | null;
  readonly worktreeChangedFiles: TreeFile[];
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
  const prevCommandModeRef = useRef(commandMode);
  const modeChanged = prevCommandModeRef.current !== commandMode;
  prevCommandModeRef.current = commandMode;
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
    queryKey: ["repository", activeProjectPath],
    queryFn: () =>
      loadRepository(
        requireQueryInput(activeProjectPath, "repository path"),
        null,
        null,
      ),
    enabled: Boolean(activeProjectPath),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const gitQueriesEnabled = Boolean(
    activeProjectPath &&
      !repositoryQuery.isPlaceholderData &&
      repositoryQuery.data?.summary.isGitRepo,
  );

  // The whole query object is returned to consumers (App.tsx) that read many
  // fields (data/isFetching/isError/refetch/isPlaceholderData), so it must be
  // held as one value per the rule's own false-positive guidance.
  // oxlint-disable-next-line react-doctor/query-destructure-result
  const changedFilesQuery = useQuery({
    queryKey: ["changed-files", activeProjectPath, activeCommit],
    queryFn: () =>
      getChangedFiles(
        requireQueryInput(activeProjectPath, "changed files path"),
        activeCommit,
      ),
    enabled: gitQueriesEnabled,
    placeholderData: keepPreviousData,
    retry: false,
  });

  // The commit panel is tied to the current branch worktree, not to the
  // selected history commit, so it needs an explicit worktree status query.
  const worktreeChangedFilesQuery = useQuery({
    queryKey: ["changed-files", activeProjectPath, null],
    queryFn: () =>
      getChangedFiles(
        requireQueryInput(activeProjectPath, "worktree changed files path"),
        null,
      ),
    enabled: gitQueriesEnabled,
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
    enabled: gitQueriesEnabled,
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
    enabled: gitQueriesEnabled,
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
  const projectFiles = useStableTreeFiles(projectFilesQuery.data);

  const searchFn =
    commandMode === "references"
      ? searchSymbolReferences
      : commandMode === "content"
        ? searchFileContents
        : searchFileNames;
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
    placeholderData: modeChanged ? undefined : keepPreviousData,
    retry: false,
  });

  const payload = repositoryQuery.data;
  const projectFileByPath = useMemo(
    () =>
      new Map(
        (projectFiles ?? repositoryQuery.data?.files ?? []).map(
          (file) => [file.path, file],
        ),
      ),
    [projectFiles, repositoryQuery.data?.files],
  );
  const selectedProjectFile = useMemo(
    () =>
      selectedProjectPath
        ? projectFileByPath.get(selectedProjectPath) ?? null
        : null,
    [projectFileByPath, selectedProjectPath],
  );
  const selectedProjectStatus = selectedProjectFile?.status ?? null;
  const changedFiles = changedFilesQuery.data ?? payload?.files ?? [];
  const worktreeChangedFiles = worktreeChangedFilesQuery.data ?? [];
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
    changedFiles,
    changedFilesQuery,
    commandResults,
    commits,
    commitsQuery,
    currentBranchRef,
    fileSearchQuery,
    filteredCommits,
    payload,
    projectFiles,
    projectFilesQuery,
    reflogEntries,
    reflogQuery,
    repositoryQuery,
    selectedBranch,
    selectedBranchRef,
    selectedCommit,
    selectedProjectFile,
    selectedProjectStatus,
    worktreeChangedFiles,
  };
}

function useStableTreeFiles(files: TreeFile[] | undefined): TreeFile[] | undefined {
  const stableRef = useRef<{
    readonly files: TreeFile[] | undefined;
    readonly signature: string | null;
  }>({
    files: undefined,
    signature: null,
  });

  if (!files) {
    if (stableRef.current.files !== undefined) {
      stableRef.current = {
        files: undefined,
        signature: null,
      };
    }
    return undefined;
  }

  const signature = treeFilesSignature(files);
  if (stableRef.current.signature !== signature) {
    stableRef.current = {
      files,
      signature,
    };
  }

  return stableRef.current.files;
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
    tracking: null,
  };
}
