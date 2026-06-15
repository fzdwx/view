import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Folder,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequestArrow,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Square,
  Tag,
  X,
} from "lucide-react";
import { DiffPanel } from "./components/DiffPanel";
import { TreePanel } from "./components/TreePanel";
import {
  type BranchInfo,
  type CommitInfo,
  type FileContent,
  type RepositoryPayload,
  type TagInfo,
  fetchRemotes,
  getCommits,
  getFileContent,
  getFileDiff,
  getProjectFiles,
  isTauriRuntime,
  loadRepository,
} from "./lib/api";
import {
  buildCommitGraph,
  type CommitGraphRow,
} from "./lib/commitGraph";
import { filterDiffFiles, parseRepositoryDiff } from "./lib/diff";
import {
  type SavedProject,
  loadSavedProjects,
  projectNameFromPath,
  saveProjects,
  upsertProject,
} from "./lib/projects";

export function App() {
  const [projects, setProjects] = useState<SavedProject[]>(() =>
    loadSavedProjects(),
  );
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    () => loadSavedProjects()[0]?.id ?? null,
  );
  const [activeBranchRef, setActiveBranchRef] = useState<string | null>(null);
  const [activeCommit, setActiveCommit] = useState<string | null>(null);
  const [selectedProjectPath, setSelectedProjectPath] = useState<string | null>(null);
  const [selectedChangePath, setSelectedChangePath] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"file" | "diff">("file");
  const [commitFilter, setCommitFilter] = useState("");
  const [panelSizes, setPanelSizes] = useState({
    rail: 292,
    tree: 300,
    log: 280,
    branch: 260,
    details: 320,
  });
  const remoteFetchInFlightRef = useRef(false);

  useEffect(() => {
    saveProjects(projects);
  }, [projects]);

  const activeProject = projects.find(
    (project) => project.id === activeProjectId,
  );

  const repositoryQuery = useQuery({
    queryKey: ["repository", activeProject?.activePath, activeCommit],
    queryFn: () =>
      loadRepository(activeProject!.activePath, activeCommit, null),
    enabled: Boolean(activeProject),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const commitsQuery = useQuery({
    queryKey: ["commits", activeProject?.activePath, activeBranchRef],
    queryFn: () => getCommits(activeProject!.activePath, activeBranchRef),
    enabled: Boolean(activeProject),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const projectFilesQuery = useQuery({
    queryKey: ["project-files", activeProject?.activePath],
    queryFn: () => getProjectFiles(activeProject!.activePath),
    enabled: Boolean(activeProject),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const fileContentQuery = useQuery({
    queryKey: ["file-content", activeProject?.activePath, selectedProjectPath],
    queryFn: async () => {
      const rootPath = activeProject!.activePath;
      const filePath = selectedProjectPath!;

      return {
        rootPath,
        filePath,
        file: await getFileContent(rootPath, filePath),
      };
    },
    enabled: Boolean(activeProject && selectedProjectPath),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const fileDiffQuery = useQuery({
    queryKey: [
      "file-diff",
      activeProject?.activePath,
      activeCommit,
      selectedChangePath,
    ],
    queryFn: async () => {
      const rootPath = activeProject!.activePath;
      const commit = activeCommit ?? null;
      const filePath = selectedChangePath!;

      return {
        rootPath,
        commit,
        filePath,
        diff: await getFileDiff(rootPath, filePath, commit),
      };
    },
    enabled: Boolean(activeProject && selectedChangePath && previewMode === "diff"),
    placeholderData: keepPreviousData,
    retry: false,
  });

  useEffect(() => {
    const payload = repositoryQuery.data;
    if (!payload || !activeProject) {
      return;
    }

    setProjects((current) =>
      current.map((project) =>
        project.id === activeProject.id
          ? {
              ...project,
              rootPath: projectRootFromPayload(payload),
              name: projectNameFromPath(projectRootFromPayload(payload)),
            }
          : project,
      ),
    );
  }, [activeProject, repositoryQuery.data]);

  const payload = repositoryQuery.data;
  const currentFileDiff =
    fileDiffQuery.data?.rootPath === activeProject?.activePath &&
    fileDiffQuery.data?.commit === (activeCommit ?? null) &&
    fileDiffQuery.data?.filePath === selectedChangePath
      ? fileDiffQuery.data
      : null;
  const currentFileContent =
    fileContentQuery.data?.rootPath === activeProject?.activePath &&
    fileContentQuery.data?.filePath === selectedProjectPath
      ? fileContentQuery.data.file
      : null;
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
  const commits = commitsQuery.data ?? payload?.commits ?? [];
  const filteredCommits = useMemo(
    () => filterCommits(commits, commitFilter),
    [commits, commitFilter],
  );
  const currentBranchRef =
    payload?.summary.branches.find((branch) => branch.current)?.refName ?? null;
  const selectedBranchRef = activeBranchRef ?? currentBranchRef;
  const selectedCommit =
    commits.find((commit) => commit.hash === activeCommit) ?? null;
  const appShellStyle = {
    gridTemplateColumns: `${panelSizes.rail}px 6px minmax(0, 1fr)`,
  };
  const contentGridStyle = {
    gridTemplateColumns: `${panelSizes.tree}px 6px minmax(0, 1fr)`,
    gridTemplateRows: `minmax(0, 1fr) 6px ${panelSizes.log}px`,
  };
  const gitLogStyle = {
    gridTemplateColumns: `${panelSizes.branch}px 6px minmax(0, 1fr) 6px ${panelSizes.details}px`,
  };

  useEffect(() => {
    if (!selectedProjectPath) {
      return;
    }

    const files = projectFilesQuery.data ?? [];
    if (files.length === 0) {
      setSelectedProjectPath(null);
      return;
    }

    const stillExists = files.some((file) => file.path === selectedProjectPath);
    if (!stillExists) {
      setSelectedProjectPath(null);
    }
  }, [projectFilesQuery.data, selectedProjectPath]);

  useEffect(() => {
    if (!selectedChangePath) {
      return;
    }

    const files = payload?.files ?? [];
    if (files.length === 0) {
      setSelectedChangePath(null);
      return;
    }

    const stillExists = files.some((file) => file.path === selectedChangePath);
    if (!stillExists) {
      setSelectedChangePath(files[0]?.path ?? null);
    }
  }, [payload?.files, selectedChangePath]);

  useEffect(() => {
    if (previewMode !== "diff" || selectedChangePath || !payload?.files.length) {
      return;
    }
    setSelectedChangePath(payload.files[0].path);
  }, [payload?.files, previewMode, selectedChangePath]);

  useEffect(() => {
    if (!activeProject || !isTauriRuntime()) {
      return;
    }

    const refreshRemoteRefs = async () => {
      if (remoteFetchInFlightRef.current) {
        return;
      }

      remoteFetchInFlightRef.current = true;
      try {
        await fetchRemotes(activeProject.activePath);
        await Promise.all([
          repositoryQuery.refetch(),
          commitsQuery.refetch(),
          projectFilesQuery.refetch(),
        ]);
      } catch (error) {
        console.warn("Failed to fetch remotes", error);
      } finally {
        remoteFetchInFlightRef.current = false;
      }
    };
    const timer = window.setInterval(refreshRemoteRefs, 120_000);

    return () => window.clearInterval(timer);
  }, [
    activeProject?.activePath,
    commitsQuery.refetch,
    projectFilesQuery.refetch,
    repositoryQuery.refetch,
  ]);

  async function chooseRepository() {
    if (!isTauriRuntime()) {
      return;
    }

    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open Git repository",
    });

    if (typeof selected !== "string") {
      return;
    }

    setActiveCommit(null);
    setActiveBranchRef(null);
    setSelectedProjectPath(null);
    setSelectedChangePath(null);
    setPreviewMode("file");

    const nextProjects = upsertProject(projects, selected);
    setProjects(nextProjects);
    setActiveProjectId(
      nextProjects.find((project) => project.rootPath === selected)?.id ??
        nextProjects.at(-1)?.id ??
        null,
    );
  }

  function removeProject(projectId: string) {
    const remaining = projects.filter((project) => project.id !== projectId);
    setProjects(remaining);
    if (activeProjectId === projectId) {
      setActiveProjectId(remaining[0]?.id ?? null);
      setActiveCommit(null);
      setActiveBranchRef(null);
      setSelectedProjectPath(null);
      setSelectedChangePath(null);
      setPreviewMode("file");
    }
  }

  function resizePanel(
    key: keyof typeof panelSizes,
    delta: number,
    min: number,
    max: number,
  ) {
    setPanelSizes((current) => ({
      ...current,
      [key]: clamp(current[key] + delta, min, max),
    }));
  }

  return (
    <main className="app-shell" style={appShellStyle}>
      <aside className="project-rail" aria-label="Projects">
        <div className="brand-row">
          <div className="brand-mark">
            <GitPullRequestArrow size={18} />
          </div>
          <div>
            <div className="brand-title">View</div>
            <div className="brand-subtitle">Git diff workbench</div>
          </div>
        </div>

        <button className="primary-action rail-action" onClick={chooseRepository}>
          <Plus size={16} />
          Open repository
        </button>

        <div className="rail-section-title">
          <span>Projects</span>
          <span>{projects.length}</span>
        </div>
        <div className="project-list">
          {projects.length === 0 ? (
            <div className="rail-empty">
              Add a repository to inspect logs, worktrees, and diffs.
            </div>
          ) : null}
          {projects.map((project) => (
            <ProjectItem
              key={project.id}
              project={project}
              active={project.id === activeProjectId}
              onSelect={() => {
                setActiveProjectId(project.id);
                setActiveCommit(null);
                setActiveBranchRef(null);
                setSelectedProjectPath(null);
                setSelectedChangePath(null);
                setPreviewMode("file");
              }}
              onRemove={() => removeProject(project.id)}
            />
          ))}
        </div>
      </aside>
      <ResizeHandle
        axis="x"
        className="app-splitter"
        label="Resize project panel"
        onResize={(delta) => resizePanel("rail", delta, 220, 460)}
      />

      <section className="workspace">
        <HeaderBar
          payload={payload}
          activeProject={activeProject}
          loading={repositoryQuery.isFetching || commitsQuery.isFetching}
          onRefresh={() => {
            void Promise.all([
              repositoryQuery.refetch(),
              commitsQuery.refetch(),
              projectFilesQuery.refetch(),
            ]);
          }}
        />

        {!activeProject ? (
          <div className="welcome-surface">
            <div className="welcome-icon">
              <FolderOpen size={26} />
            </div>
            <h1>Open a Git repository</h1>
            <p>
              View keeps multiple repositories in the rail and lets each project
              switch between its Git worktrees.
            </p>
            <button className="primary-action compact" onClick={chooseRepository}>
              <FolderOpen size={16} />
              Choose folder
            </button>
          </div>
        ) : repositoryQuery.isError ? (
          <div className="error-surface">
            <div className="error-title">Repository could not be loaded</div>
            <pre>{String(repositoryQuery.error.message)}</pre>
          </div>
        ) : (
          <div className="content-grid" style={contentGridStyle}>
            <section className="tree-panel">
              {projectFilesQuery.data ? (
                <TreePanel
                  files={projectFilesQuery.data}
                  selectedPath={selectedProjectPath}
                  title="Project"
                  emptyTitle="No project files"
                  emptyCopy="Tracked and untracked files will appear here."
                  onSelectPath={(path) => {
                    setSelectedProjectPath(path);
                    setPreviewMode("file");
                  }}
                />
              ) : (
                <LoadingRows />
              )}
            </section>
            <ResizeHandle
              axis="x"
              className="tree-diff-splitter"
              label="Resize file tree panel"
              onResize={(delta) => resizePanel("tree", delta, 220, 560)}
            />

            <section className="diff-panel">
              <div className="diff-topbar">
                <div>
                  <div className="panel-title">
                    {previewMode === "diff"
                      ? selectedChangePath ?? "Diff preview"
                      : selectedProjectPath ?? "File preview"}
                  </div>
                  <div className="panel-kicker">
                    {previewMode === "diff"
                      ? activeCommit
                        ? selectedCommit?.shortHash
                        : "staged + unstaged"
                      : "read-only workspace file"}
                  </div>
                </div>
                <div className="diff-topbar-meta">
                  {previewMode === "diff" && diffStats.files > 0 ? (
                    <div className="diff-stat-strip" aria-label="Diff line counts">
                      <span className="addition">+{diffStats.additions}</span>
                      <span className="deletion">-{diffStats.deletions}</span>
                    </div>
                  ) : null}
                  {repositoryQuery.isFetching ||
                  fileDiffQuery.isFetching ||
                  fileContentQuery.isFetching ? (
                    <Loader2 className="spin" size={16} />
                  ) : null}
                </div>
              </div>
              {previewMode === "file" ? (
                <FilePreview
                  error={
                    fileContentQuery.isError
                      ? String(fileContentQuery.error.message)
                      : null
                  }
                  file={currentFileContent}
                  loading={Boolean(
                    selectedProjectPath &&
                      fileContentQuery.isFetching &&
                      !currentFileContent,
                  )}
                  selectedPath={selectedProjectPath}
                />
              ) : payload && fileDiffQuery.isFetching && !currentFileDiff ? (
                <div className="diff-loading">
                  <Loader2 className="spin" size={18} />
                </div>
              ) : payload ? (
                <DiffPanel
                  error={
                    parsedDiff.error ??
                    (fileDiffQuery.isError
                      ? String(fileDiffQuery.error.message)
                      : null)
                  }
                  files={visibleDiffFiles}
                  title={selectedChangePath ?? "Repository diff"}
                />
              ) : (
                <div className="diff-loading">
                  <Loader2 className="spin" size={18} />
                </div>
              )}
            </section>
            <ResizeHandle
              axis="y"
              className="main-log-splitter"
              label="Resize Git log panel"
              onResize={(delta) => resizePanel("log", -delta, 180, 560)}
            />

            <section className="git-log-panel" style={gitLogStyle}>
              <section className="branch-panel">
                {payload ? (
                  <BranchTree
                    branches={payload.summary.branches}
                    tags={payload.summary.tags}
                    activeRef={selectedBranchRef}
                    onSelect={(refName) => {
                      setActiveBranchRef(refName);
                      setActiveCommit(null);
                      setSelectedChangePath(null);
                      setPreviewMode("diff");
                    }}
                  />
                ) : (
                  <LoadingRows />
                )}
              </section>
              <ResizeHandle
                axis="x"
                className="branch-history-splitter"
                label="Resize branch tree panel"
                onResize={(delta) => resizePanel("branch", delta, 180, 460)}
              />

              <section className="history-panel">
                <div className="panel-toolbar">
                  <div>
                    <div className="panel-title">History</div>
                    <div className="panel-kicker">
                      {activeCommit ? "Commit diff" : "Working tree diff"}
                    </div>
                  </div>
                  <button
                    className={activeCommit ? "ghost-button" : "ghost-button active"}
                    onClick={() => {
                      setActiveCommit(null);
                      setSelectedChangePath(null);
                      setPreviewMode("diff");
                    }}
                  >
                    <CheckCircle2 size={15} />
                    Working tree
                  </button>
                </div>

                <label className="search-field">
                  <Search size={15} />
                  <input
                    value={commitFilter}
                    onChange={(event) => setCommitFilter(event.target.value)}
                    placeholder="Filter commits"
                  />
                </label>

                <VirtualCommitList
                  commits={filteredCommits}
                  activeCommit={activeCommit}
                  loading={commitsQuery.isLoading}
                  onSelectCommit={(hash) => {
                    setActiveCommit(hash);
                    setSelectedChangePath(null);
                    setPreviewMode("diff");
                  }}
                />
              </section>
              <ResizeHandle
                axis="x"
                className="history-detail-splitter"
                label="Resize details panel"
                onResize={(delta) => resizePanel("details", -delta, 220, 560)}
              />

              <CommitInspector
                branchName={
                  payload?.summary.branches.find(
                    (branch) => branch.refName === selectedBranchRef,
                  )?.name ??
                  payload?.summary.tags.find(
                    (tag) => tag.refName === selectedBranchRef,
                  )?.name ??
                  payload?.summary.branch
                }
                commit={selectedCommit}
                files={payload?.files ?? []}
                selectedPath={selectedChangePath}
                onSelectPath={(path) => {
                  setSelectedChangePath(path);
                  setPreviewMode("diff");
                }}
              />
            </section>
          </div>
        )}
      </section>
    </main>
  );
}

function FilePreview({
  error,
  file,
  loading,
  selectedPath,
}: {
  error: string | null;
  file: FileContent | null;
  loading: boolean;
  selectedPath: string | null;
}) {
  if (loading) {
    return (
      <div className="diff-loading">
        <Loader2 className="spin" size={18} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state">
        <div className="empty-title">File could not be opened</div>
        <div className="empty-copy">{error}</div>
      </div>
    );
  }

  if (!selectedPath) {
    return (
      <div className="empty-state">
        <div className="empty-title">Select a file</div>
        <div className="empty-copy">
          The project tree shows tracked and untracked files from the repository.
        </div>
      </div>
    );
  }

  if (!file) {
    return null;
  }

  if (file.binary) {
    return (
      <div className="empty-state">
        <div className="empty-title">Binary file</div>
        <div className="empty-copy">{file.path} cannot be rendered as text.</div>
      </div>
    );
  }

  if (file.tooLarge) {
    return (
      <div className="empty-state">
        <div className="empty-title">File is too large</div>
        <div className="empty-copy">
          Files larger than 1 MB are not opened in the preview.
        </div>
      </div>
    );
  }

  return (
    <section className="file-preview-frame" aria-label={file.path}>
      <pre className="file-preview-code">{file.content}</pre>
    </section>
  );
}

function ResizeHandle({
  axis,
  className,
  label,
  onResize,
}: {
  axis: "x" | "y";
  className: string;
  label: string;
  onResize(delta: number): void;
}) {
  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();

    let lastPosition = axis === "x" ? event.clientX : event.clientY;
    document.body.classList.add(
      axis === "x" ? "is-resizing-x" : "is-resizing-y",
    );

    function handleMove(moveEvent: PointerEvent) {
      const nextPosition =
        axis === "x" ? moveEvent.clientX : moveEvent.clientY;
      onResize(nextPosition - lastPosition);
      lastPosition = nextPosition;
    }

    function stopResize() {
      document.body.classList.remove("is-resizing-x", "is-resizing-y");
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 30 : 10;
    if (axis === "x" && event.key === "ArrowLeft") {
      event.preventDefault();
      onResize(-step);
    } else if (axis === "x" && event.key === "ArrowRight") {
      event.preventDefault();
      onResize(step);
    } else if (axis === "y" && event.key === "ArrowUp") {
      event.preventDefault();
      onResize(-step);
    } else if (axis === "y" && event.key === "ArrowDown") {
      event.preventDefault();
      onResize(step);
    }
  }

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      tabIndex={0}
      className={`resize-handle ${
        axis === "x" ? "resize-handle-x" : "resize-handle-y"
      } ${className}`}
      onPointerDown={startResize}
      onKeyDown={handleKeyDown}
    />
  );
}

function BranchTree({
  branches,
  tags,
  activeRef,
  onSelect,
}: {
  branches: BranchInfo[];
  tags: TagInfo[];
  activeRef: string | null;
  onSelect(refName: string): void;
}) {
  const [branchFilter, setBranchFilter] = useState("");
  const localBranches = useMemo(
    () =>
      filterRefs(
        branches.filter((branch) => branch.branchType === "local"),
        branchFilter,
      ),
    [branches, branchFilter],
  );
  const remoteBranches = useMemo(
    () =>
      filterRefs(
        branches.filter((branch) => branch.branchType === "remote"),
        branchFilter,
      ),
    [branches, branchFilter],
  );
  const visibleTags = useMemo(
    () => filterRefs(tags, branchFilter),
    [tags, branchFilter],
  );
  const currentBranch = branches.find((branch) => branch.current);
  const showCurrentBranch =
    currentBranch && filterRefs([currentBranch], branchFilter).length > 0;
  const refCount = branches.length + tags.length;
  const visibleRefCount = localBranches.length + remoteBranches.length + visibleTags.length;

  return (
    <div className="branch-tree">
      <div className="panel-toolbar compact-toolbar">
        <div>
          <div className="panel-title">Branches</div>
          <div className="panel-kicker">
            {branchFilter.trim() ? `${visibleRefCount} / ${refCount} refs` : `${refCount} refs`}
          </div>
        </div>
      </div>

      <label className="search-field branch-search">
        <Search size={15} />
        <input
          value={branchFilter}
          onChange={(event) => setBranchFilter(event.target.value)}
          placeholder="Filter branches"
        />
      </label>

      <div className="branch-scroll">
        {showCurrentBranch ? (
          <button
            className={
              currentBranch.refName === activeRef
                ? "branch-head-row active"
                : "branch-head-row"
            }
            onClick={() => onSelect(currentBranch.refName)}
          >
            <span>HEAD</span>
            <small>{currentBranch.name}</small>
          </button>
        ) : null}
        <BranchGroup
          title="Local"
          branches={localBranches}
          filtering={branchFilter.trim().length > 0}
          activeRef={activeRef}
          onSelect={onSelect}
        />
        <BranchGroup
          title="Remote"
          branches={remoteBranches}
          filtering={branchFilter.trim().length > 0}
          activeRef={activeRef}
          onSelect={onSelect}
        />
        <TagGroup tags={visibleTags} activeRef={activeRef} onSelect={onSelect} />
      </div>
    </div>
  );
}

function BranchGroup({
  title,
  branches,
  filtering,
  activeRef,
  onSelect,
}: {
  title: string;
  branches: BranchInfo[];
  filtering: boolean;
  activeRef: string | null;
  onSelect(refName: string): void;
}) {
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapsed, setCollapsed] = useState(false);
  const tree = useMemo(
    () =>
      buildRefTree(
        branches.map((branch) => ({
          name: branch.name,
          refName: branch.refName,
          current: branch.current,
          ahead: branch.ahead,
          behind: branch.behind,
          upstream: branch.upstream,
          kind: "branch" as const,
        })),
      ),
    [branches],
  );

  if (branches.length === 0) {
    return null;
  }

  function toggleFolder(key: string) {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <div className="branch-group">
      <button
        className="branch-group-title"
        aria-expanded={!collapsed || filtering}
        onClick={() => setCollapsed((current) => !current)}
      >
        {collapsed && !filtering ? (
          <ChevronRight size={14} />
        ) : (
          <ChevronDown size={14} />
        )}
        <span>{title}</span>
      </button>
      {collapsed && !filtering
        ? null
        : tree.map((node) => (
            <RefTreeNode
              key={node.key}
              node={node}
              activeRef={activeRef}
              depth={0}
              filtering={filtering}
              onSelect={onSelect}
              collapsedFolders={collapsedFolders}
              onToggleFolder={toggleFolder}
            />
          ))}
    </div>
  );
}

function filterRefs<T extends { name: string; refName: string }>(
  refs: T[],
  filter: string,
): T[] {
  const normalized = filter.trim().toLowerCase();
  if (!normalized) {
    return refs;
  }

  return refs.filter((ref) =>
    `${ref.name} ${ref.refName}`.toLowerCase().includes(normalized),
  );
}

function TagGroup({
  tags,
  activeRef,
  onSelect,
}: {
  tags: TagInfo[];
  activeRef: string | null;
  onSelect(refName: string): void;
}) {
  if (tags.length === 0) {
    return null;
  }

  return (
    <div className="branch-group">
      <div className="branch-group-title">
        <ChevronDown size={14} />
        <span>Tags</span>
      </div>
      {tags.map((tag) => (
        <button
          key={tag.refName}
          className={tag.refName === activeRef ? "branch-row active" : "branch-row"}
          style={{ "--branch-depth": 0 } as CSSProperties}
          onClick={() => onSelect(tag.refName)}
        >
          <Tag size={13} />
          <span>{tag.name}</span>
        </button>
      ))}
    </div>
  );
}

type RefLeaf = {
  name: string;
  refName: string;
  current: boolean;
  ahead: number | null;
  behind: number | null;
  upstream: string | null;
  kind: "branch";
};

type RefNode = {
  key: string;
  name: string;
  children: RefNode[];
  leaf?: RefLeaf;
};

function RefTreeNode({
  node,
  activeRef,
  depth,
  filtering,
  onSelect,
  collapsedFolders,
  onToggleFolder,
}: {
  node: RefNode;
  activeRef: string | null;
  depth: number;
  filtering: boolean;
  onSelect(refName: string): void;
  collapsedFolders: Set<string>;
  onToggleFolder(key: string): void;
}) {
  if (node.leaf) {
    return (
      <button
        className={
          node.leaf.refName === activeRef ? "branch-row active" : "branch-row"
        }
        style={{ "--branch-depth": depth } as CSSProperties}
        onClick={() => onSelect(node.leaf!.refName)}
      >
        <GitBranch size={13} />
        <span>{node.name}</span>
        <BranchTrackingBadge branch={node.leaf} />
      </button>
    );
  }

  const collapsed = !filtering && collapsedFolders.has(node.key);

  return (
    <div className="branch-folder">
      <button
        className="branch-folder-row"
        style={{ "--branch-depth": depth } as CSSProperties}
        aria-expanded={!collapsed}
        onClick={() => onToggleFolder(node.key)}
      >
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        <Folder size={13} />
        <span>{node.name}</span>
      </button>
      {collapsed ? null : node.children.map((child) => (
        <RefTreeNode
          key={child.key}
          node={child}
          activeRef={activeRef}
          depth={depth + 1}
          filtering={filtering}
          onSelect={onSelect}
          collapsedFolders={collapsedFolders}
          onToggleFolder={onToggleFolder}
        />
      ))}
    </div>
  );
}

function buildRefTree(refs: RefLeaf[]): RefNode[] {
  const root: RefNode[] = [];

  for (const ref of refs) {
    const parts = ref.name.split("/").filter(Boolean);
    let siblings = root;
    let keyPath = "";

    parts.forEach((part, index) => {
      keyPath = keyPath ? `${keyPath}/${part}` : part;
      const isLeaf = index === parts.length - 1;

      if (isLeaf) {
        siblings.push({
          key: ref.refName,
          name: part,
          children: [],
          leaf: ref,
        });
        return;
      }

      let folder = siblings.find(
        (node) => !node.leaf && node.name === part,
      );
      if (!folder) {
        folder = {
          key: keyPath,
          name: part,
          children: [],
        };
        siblings.push(folder);
      }
      siblings = folder.children;
    });
  }

  sortRefNodes(root);
  return root;
}

function sortRefNodes(nodes: RefNode[]) {
  nodes.sort((left, right) => {
    if (!left.leaf && right.leaf) {
      return -1;
    }
    if (left.leaf && !right.leaf) {
      return 1;
    }
    return left.name.localeCompare(right.name);
  });
  nodes.forEach((node) => sortRefNodes(node.children));
}

function BranchTrackingBadge({ branch }: { branch: RefLeaf }) {
  const hasAhead = Boolean(branch.ahead && branch.ahead > 0);
  const hasBehind = Boolean(branch.behind && branch.behind > 0);

  if (branch.current || hasAhead || hasBehind) {
    return (
      <small className="branch-badges">
        {hasBehind ? (
          <span className="branch-behind" title="Remote branch is ahead">
            ↙ {branch.behind}
          </span>
        ) : null}
        {hasAhead ? (
          <span className="branch-ahead" title="Local branch is ahead">
            ↗ {branch.ahead}
          </span>
        ) : null}
        {branch.current ? <span className="branch-head-badge">HEAD</span> : null}
      </small>
    );
  }

  return null;
}

function CommitInspector({
  commit,
  branchName,
  files,
  selectedPath,
  onSelectPath,
}: {
  commit: CommitInfo | null;
  branchName?: string;
  files: RepositoryPayload["files"];
  selectedPath: string | null;
  onSelectPath(path: string): void;
}) {
  return (
    <aside className="commit-detail-panel">
      <div className="commit-changes-panel">
        <TreePanel
          files={files}
          selectedPath={selectedPath}
          title="Changes"
          emptyTitle="No changed files"
          emptyCopy="Select a commit with file changes, or inspect working tree changes."
          onSelectPath={onSelectPath}
        />
      </div>
      <CommitDetails
        branchName={branchName}
        commit={commit}
        fileCount={files.length}
        selectedPath={selectedPath}
      />
    </aside>
  );
}

function CommitDetails({
  commit,
  branchName,
  fileCount,
  selectedPath,
}: {
  commit: CommitInfo | null;
  branchName?: string;
  fileCount: number;
  selectedPath: string | null;
}) {
  return (
    <section className="commit-details-section">
      <div className="panel-toolbar compact-toolbar">
        <div>
          <div className="panel-title">Details</div>
          <div className="panel-kicker">
            {commit ? commit.shortHash : "Working tree"}
          </div>
        </div>
      </div>

      {commit ? (
        <div className="commit-detail-body">
          <div className="detail-summary">
            <div className="detail-subject">{commit.subject}</div>
            <div className="detail-hash-pill">{commit.shortHash}</div>
          </div>
          <DetailRow label="Hash" value={commit.hash} mono />
          {commit.parents.length > 1 ? (
            <DetailRow label="Type" value="Merge commit" />
          ) : null}
          {commit.parents.length > 0 ? (
            <DetailRow
              label={commit.parents.length > 1 ? "Parents" : "Parent"}
              value={commit.parents
                .map((parent) => parent.slice(0, 8))
                .join(", ")}
              mono
            />
          ) : null}
          <DetailRow label="Author" value={commit.author} />
          <DetailRow label="Date" value={formatDate(commit.date)} mono />
          <DetailRow label="Branch" value={branchName ?? "current"} />
          <DetailRow label="Files" value={String(fileCount)} mono />
          <DetailRow label="Selected" value={selectedPath ?? "none"} mono />
        </div>
      ) : (
        <div className="commit-detail-body">
          <div className="detail-summary">
            <div className="detail-subject">Working tree changes</div>
            <div className="detail-hash-pill">live</div>
          </div>
          <DetailRow label="Branch" value={branchName ?? "current"} />
          <DetailRow label="Files" value={String(fileCount)} mono />
          <DetailRow label="Selected" value={selectedPath ?? "none"} mono />
        </div>
      )}
    </section>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong className={mono ? "mono-value" : undefined}>{value}</strong>
    </div>
  );
}

function ProjectItem({
  project,
  active,
  onSelect,
  onRemove,
}: {
  project: SavedProject;
  active: boolean;
  onSelect(): void;
  onRemove(): void;
}) {
  return (
    <div className={active ? "project-item active" : "project-item"}>
      <button className="project-button" onClick={onSelect}>
        <span className="project-name">{project.name}</span>
        <span className="project-path">{project.activePath}</span>
      </button>
      <button className="project-remove" onClick={onRemove} aria-label="Remove">
        <X size={14} />
      </button>
    </div>
  );
}

function HeaderBar({
  payload,
  activeProject,
  loading,
  onRefresh,
}: {
  payload?: RepositoryPayload;
  activeProject?: SavedProject;
  loading: boolean;
  onRefresh(): void;
}) {
  const counts = payload?.summary.statusCounts;
  const appWindow = isTauriRuntime() ? getCurrentWindow() : null;

  return (
    <header className="workspace-header">
      <div className="repo-heading" data-tauri-drag-region>
        <div className="repo-name">
          {activeProject?.name ?? "No repository selected"}
        </div>
        <div className="repo-meta">
          {payload ? (
            <>
              <span>
                <GitBranch size={13} />
                {payload.summary.branch}
              </span>
              <span>
                <GitCommitHorizontal size={13} />
                {payload.summary.head}
              </span>
              <span>{payload.summary.root}</span>
            </>
          ) : (
            <span>{activeProject?.activePath ?? "Choose a folder to start"}</span>
          )}
        </div>
      </div>
      <div className="header-actions">
        {counts ? (
          <div className="status-strip">
            <span>+{counts.added}</span>
            <span>~{counts.modified}</span>
            <span>-{counts.deleted}</span>
            <span>?{counts.untracked}</span>
          </div>
        ) : null}
        <button className="ghost-button" onClick={onRefresh}>
          {loading ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
          Refresh
        </button>
        <div className="window-controls" aria-label="Window controls">
          <button
            className="window-control"
            aria-label="Minimize"
            onClick={() => appWindow?.minimize()}
          >
            <Minus size={14} />
          </button>
          <button
            className="window-control"
            aria-label="Maximize"
            onClick={() => appWindow?.toggleMaximize()}
          >
            <Square size={12} />
          </button>
          <button
            className="window-control close"
            aria-label="Close"
            onClick={() => appWindow?.close()}
          >
            <X size={15} />
          </button>
        </div>
      </div>
    </header>
  );
}

function VirtualCommitList({
  commits,
  activeCommit,
  loading,
  onSelectCommit,
}: {
  commits: CommitInfo[];
  activeCommit: string | null;
  loading: boolean;
  onSelectCommit(hash: string): void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const graphRows = useMemo(() => buildCommitGraph(commits), [commits]);
  const commitGraphWidth = useMemo(
    () =>
      Math.max(
        30,
        ...graphRows.map((row) => getCommitGraphWidth(row.laneCount)),
      ),
    [graphRows],
  );
  const tableStyle = {
    "--commit-graph-width": `${commitGraphWidth}px`,
  } as CSSProperties;
  const virtualizer = useVirtualizer({
    count: graphRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 28,
    overscan: 16,
    directDomUpdates: true,
    useFlushSync: false,
  });

  if (loading) {
    return (
      <div className="commit-table" style={tableStyle}>
        <CommitListHeader />
        <div className="commit-list">
          <LoadingRows />
        </div>
      </div>
    );
  }

  if (graphRows.length === 0) {
    return (
      <div className="commit-table" style={tableStyle}>
        <CommitListHeader />
        <div className="commit-list empty-list">
          <div className="empty-inline">No commits match the current filter.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="commit-table" style={tableStyle}>
      <CommitListHeader />
      <div ref={scrollRef} className="commit-list">
        <div className="commit-list-spacer" ref={virtualizer.containerRef}>
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const graphRow = graphRows[virtualItem.index];
            const commit = graphRow.commit;
            return (
              <div
                key={commit.hash}
                className="commit-list-virtual-row"
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
              >
                <CommitRow
                  row={graphRow}
                  active={activeCommit === commit.hash}
                  onClick={() => onSelectCommit(commit.hash)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CommitListHeader() {
  return (
    <div className="commit-list-header" aria-hidden="true">
      <span />
      <span>Commit</span>
      <span>Author</span>
      <span>Date</span>
      <span>Hash</span>
    </div>
  );
}

function CommitRow({
  row,
  active,
  onClick,
}: {
  row: CommitGraphRow;
  active: boolean;
  onClick(): void;
}) {
  const { commit } = row;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      title={`${commit.subject} (${commit.shortHash})`}
      className={active ? "commit-row active" : "commit-row"}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      <span className="commit-graph-cell">
        <CommitGraph row={row} />
      </span>
      <span className="commit-subject">
        <span>{commit.subject}</span>
      </span>
      <span className="commit-author">{commit.author}</span>
      <span className="commit-date">{formatDate(commit.date)}</span>
      <span className="commit-hash">{commit.shortHash}</span>
    </div>
  );
}

function CommitGraph({ row }: { row: CommitGraphRow }) {
  const width = getCommitGraphWidth(row.laneCount);
  const height = COMMIT_GRAPH_ROW_HEIGHT;
  const laneX = (lane: number) =>
    lane * COMMIT_GRAPH_LANE_GAP + COMMIT_GRAPH_LEFT_INSET;
  const dotX = laneX(row.lane);
  const graphColor = (colorKey: string) => ({
    "--commit-graph-color": commitGraphColor(colorKey),
  } as CSSProperties);
  const dotRadius = row.commit.parents.length > 1 ? 3.12 : 2.9;
  const dotGap = dotRadius + 0.08;
  const parentCurves = row.parentLanes.filter(
    (parentLane) => parentLane.index !== row.lane,
  );

  return (
    <span className="commit-graph" aria-hidden="true">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {row.throughLanes.map((throughLane) => (
          <path
            key={`through-${throughLane.fromIndex}-${throughLane.toIndex}`}
            className="commit-graph-line commit-graph-through-line"
            d={commitGraphThroughPath(
              laneX(throughLane.fromIndex),
              laneX(throughLane.toIndex),
            )}
            style={graphColor(throughLane.colorKey)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {parentCurves.map((parentLane, curveIndex) => {
          const parentX = laneX(parentLane.index);
          return (
            <path
              key={`parent-${parentLane.index}-${curveIndex}`}
              className="commit-graph-line commit-graph-parent-line"
              d={commitGraphCurvePath(
                dotX,
                parentX,
                dotGap,
                curveIndex,
                parentCurves.length,
              )}
              style={graphColor(parentLane.colorKey)}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {row.beforeLanes.map((lane) => (
          <line
            key={`before-${lane.index}`}
            className={
              lane.index === row.lane
                ? "commit-graph-line commit-graph-trunk commit-graph-node-trunk"
                : "commit-graph-line commit-graph-trunk"
            }
            x1={laneX(lane.index)}
            y1="-2"
            x2={laneX(lane.index)}
            y2={
              lane.index === row.lane
                ? COMMIT_GRAPH_MID_Y - dotGap
                : COMMIT_GRAPH_MID_Y
            }
            style={graphColor(lane.colorKey)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {row.afterLanes.map((lane) => (
          <line
            key={`after-${lane.index}`}
            className={
              lane.index === row.lane
                ? "commit-graph-line commit-graph-trunk commit-graph-node-trunk"
                : "commit-graph-line commit-graph-trunk"
            }
            x1={laneX(lane.index)}
            y1={
              lane.index === row.lane
                ? COMMIT_GRAPH_MID_Y + dotGap
                : COMMIT_GRAPH_MID_Y
            }
            x2={laneX(lane.index)}
            y2={height + 2}
            style={graphColor(lane.colorKey)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <circle
          className="commit-graph-node-outline"
          cx={dotX}
          cy={COMMIT_GRAPH_MID_Y}
          r={dotRadius + 0.24}
        />
        <circle
          className={
            row.commit.parents.length > 1
              ? "commit-graph-node merge"
              : "commit-graph-node"
          }
          cx={dotX}
          cy={COMMIT_GRAPH_MID_Y}
          r={dotRadius}
          style={graphColor(row.colorKey)}
        />
      </svg>
    </span>
  );
}

const COMMIT_GRAPH_ROW_HEIGHT = 28;
const COMMIT_GRAPH_MID_Y = 14;
const COMMIT_GRAPH_LANE_GAP = 13;
const COMMIT_GRAPH_LEFT_INSET = 10.5;

function commitGraphCurvePath(
  sourceX: number,
  targetX: number,
  sourceGap: number,
  curveIndex: number,
  curveCount: number,
) {
  const bottomY = COMMIT_GRAPH_ROW_HEIGHT + 2;
  const sweep = Math.abs(targetX - sourceX);
  const fanOffset = (curveIndex - (curveCount - 1) / 2) * 0.75;
  const startX = sourceX + fanOffset;
  const startY = COMMIT_GRAPH_MID_Y + sourceGap;
  const controlY1 =
    startY + (sweep > COMMIT_GRAPH_LANE_GAP ? 3.35 : 3.8);
  const controlY2 =
    bottomY - (sweep > COMMIT_GRAPH_LANE_GAP ? 5.15 : 4.65) +
    curveIndex * 0.22;

  return `M ${startX} ${startY} C ${startX} ${controlY1}, ${targetX} ${controlY2}, ${targetX} ${bottomY}`;
}

function commitGraphThroughPath(sourceX: number, targetX: number) {
  const bottomY = COMMIT_GRAPH_ROW_HEIGHT + 2;

  return `M ${sourceX} ${COMMIT_GRAPH_MID_Y} C ${sourceX} 18.85, ${targetX} 25.55, ${targetX} ${bottomY}`;
}

function getCommitGraphWidth(laneCount: number) {
  return Math.ceil(
    Math.max(
      36,
      COMMIT_GRAPH_LEFT_INSET + (laneCount - 1) * COMMIT_GRAPH_LANE_GAP + 20,
    ),
  );
}

function commitGraphColor(colorKey: string) {
  const colors = [
    "oklch(49% 0.108 255)",
    "oklch(49% 0.105 152)",
    "oklch(51% 0.112 42)",
    "oklch(50% 0.108 332)",
    "oklch(49% 0.104 286)",
    "oklch(50% 0.095 205)",
    "oklch(49% 0.112 25)",
    "oklch(51% 0.096 110)",
  ];
  const laneColorMatch = /^lane-(\d+)$/.exec(colorKey);
  if (laneColorMatch) {
    return colors[Number(laneColorMatch[1]) % colors.length];
  }

  let hash = 0;
  for (let index = 0; index < colorKey.length; index += 1) {
    hash = (hash * 31 + colorKey.charCodeAt(index)) >>> 0;
  }

  return colors[hash % colors.length];
}

function LoadingRows() {
  return (
    <div className="loading-rows">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="loading-row" />
      ))}
    </div>
  );
}

function filterCommits(commits: CommitInfo[], filter: string): CommitInfo[] {
  const normalized = filter.trim().toLowerCase();
  if (!normalized) {
    return commits;
  }

  return commits.filter((commit) =>
    [commit.subject, commit.author, commit.hash, commit.shortHash]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}

function countDiffStats(files: ReturnType<typeof parseRepositoryDiff>["files"]) {
  return files.reduce(
    (total, file) => {
      for (const hunk of file.hunks) {
        total.additions += hunk.additionLines;
        total.deletions += hunk.deletionLines;
      }
      total.files += 1;
      return total;
    },
    { additions: 0, deletions: 0, files: 0 },
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function projectRootFromPayload(payload: RepositoryPayload): string {
  return payload.summary.worktrees[0]?.path ?? payload.summary.root;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const daysAgo = Math.round(
    (startOfToday.getTime() - startOfDate.getTime()) / 86_400_000,
  );

  if (daysAgo === 0) {
    return formatTime(date);
  }

  if (daysAgo === 1) {
    return `Yesterday ${formatTime(date)}`;
  }

  if (date.getFullYear() === now.getFullYear()) {
    return `${formatMonthDay(date)} ${formatTime(date)}`;
  }

  return `${formatMonthDay(date)} ${date.getFullYear()} ${formatTime(date)}`;
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatMonthDay(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}
