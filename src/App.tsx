import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Folder,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequestArrow,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Tag,
  X,
} from "lucide-react";
import { DiffPanel } from "./components/DiffPanel";
import { TreePanel } from "./components/TreePanel";
import {
  type BranchInfo,
  type CommitInfo,
  type RepositoryPayload,
  type TagInfo,
  getFileDiff,
  isTauriRuntime,
  loadRepository,
} from "./lib/api";
import { parseRepositoryDiff } from "./lib/diff";
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
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [commitFilter, setCommitFilter] = useState("");
  const [panelSizes, setPanelSizes] = useState({
    rail: 292,
    tree: 300,
    log: 280,
    branch: 260,
    details: 320,
  });

  useEffect(() => {
    saveProjects(projects);
  }, [projects]);

  const activeProject = projects.find(
    (project) => project.id === activeProjectId,
  );

  const repositoryQuery = useQuery({
    queryKey: [
      "repository",
      activeProject?.activePath,
      activeCommit,
      activeBranchRef,
    ],
    queryFn: () =>
      loadRepository(activeProject!.activePath, activeCommit, activeBranchRef),
    enabled: Boolean(activeProject),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const fileDiffQuery = useQuery({
    queryKey: [
      "file-diff",
      activeProject?.activePath,
      activeCommit,
      selectedPath,
    ],
    queryFn: () =>
      getFileDiff(activeProject!.activePath, selectedPath!, activeCommit),
    enabled: Boolean(activeProject && selectedPath),
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
  const parsedDiff = useMemo(
    () => parseRepositoryDiff(fileDiffQuery.data ?? ""),
    [fileDiffQuery.data],
  );
  const filteredCommits = useMemo(
    () => filterCommits(payload?.commits ?? [], commitFilter),
    [payload?.commits, commitFilter],
  );
  const currentBranchRef =
    payload?.summary.branches.find((branch) => branch.current)?.refName ?? null;
  const selectedBranchRef = activeBranchRef ?? currentBranchRef;
  const selectedCommit =
    payload?.commits.find((commit) => commit.hash === activeCommit) ?? null;
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
    if (!selectedPath) {
      return;
    }

    const files = payload?.files ?? [];
    if (files.length === 0) {
      setSelectedPath(null);
      return;
    }

    const stillExists = files.some(
      (file) => file.path === selectedPath,
    );
    if (!stillExists) {
      setSelectedPath(files[0]?.path ?? null);
    }
  }, [payload?.files, selectedPath]);

  useEffect(() => {
    if (selectedPath || !payload?.files.length) {
      return;
    }
    setSelectedPath(payload.files[0].path);
  }, [payload?.files, selectedPath]);

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
    setSelectedPath(null);

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
      setSelectedPath(null);
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

        <button className="primary-action" onClick={chooseRepository}>
          <Plus size={16} />
          Open repository
        </button>

        <div className="rail-section-title">Projects</div>
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
                setSelectedPath(null);
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
          loading={repositoryQuery.isFetching}
          onRefresh={() => repositoryQuery.refetch()}
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
              {payload ? (
                <TreePanel
                  files={payload.files}
                  selectedPath={selectedPath}
                  onSelectPath={setSelectedPath}
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
                    {selectedPath ?? "Repository diff"}
                  </div>
                  <div className="panel-kicker">
                    {activeCommit
                      ? selectedCommit?.shortHash
                      : "staged + unstaged"}
                  </div>
                </div>
                {repositoryQuery.isFetching || fileDiffQuery.isFetching ? (
                  <Loader2 className="spin" size={16} />
                ) : null}
              </div>
              {payload && fileDiffQuery.isFetching && !fileDiffQuery.data ? (
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
                  files={parsedDiff.files}
                  title={selectedPath ?? "Repository diff"}
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
                      setSelectedPath(null);
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
                    setSelectedPath(null);
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

              <div className="commit-list">
                {repositoryQuery.isLoading ? (
                  <LoadingRows />
                ) : (
                  filteredCommits.map((commit) => (
                    <CommitRow
                      key={commit.hash}
                      commit={commit}
                      active={activeCommit === commit.hash}
                      onClick={() => {
                        setActiveCommit(commit.hash);
                      }}
                    />
                  ))
                )}
              </div>
            </section>
              <ResizeHandle
                axis="x"
                className="history-detail-splitter"
                label="Resize details panel"
                onResize={(delta) => resizePanel("details", -delta, 220, 560)}
              />

              <CommitDetails
                commit={selectedCommit}
                branchName={
                  payload?.summary.branches.find(
                    (branch) => branch.refName === selectedBranchRef,
                  )?.name ??
                  payload?.summary.tags.find(
                    (tag) => tag.refName === selectedBranchRef,
                  )?.name ??
                  payload?.summary.branch
                }
                fileCount={payload?.files.length ?? 0}
                selectedPath={selectedPath}
              />
            </section>
          </div>
        )}
      </section>
    </main>
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
  const localBranches = branches.filter(
    (branch) => branch.branchType === "local",
  );
  const remoteBranches = branches.filter(
    (branch) => branch.branchType === "remote",
  );
  const currentBranch = branches.find((branch) => branch.current);
  const refCount = branches.length + tags.length;

  return (
    <div className="branch-tree">
      <div className="panel-toolbar compact-toolbar">
        <div>
          <div className="panel-title">Branches</div>
          <div className="panel-kicker">{refCount} refs</div>
        </div>
      </div>

      <div className="branch-scroll">
        {currentBranch ? (
          <button
            className={
              currentBranch.refName === activeRef
                ? "branch-head-row active"
                : "branch-head-row"
            }
            onClick={() => onSelect(currentBranch.refName)}
          >
            HEAD (Current Branch)
          </button>
        ) : null}
        <BranchGroup
          title="Local"
          branches={localBranches}
          activeRef={activeRef}
          onSelect={onSelect}
        />
        <BranchGroup
          title="Remote"
          branches={remoteBranches}
          activeRef={activeRef}
          onSelect={onSelect}
        />
        <TagGroup tags={tags} activeRef={activeRef} onSelect={onSelect} />
      </div>
    </div>
  );
}

function BranchGroup({
  title,
  branches,
  activeRef,
  onSelect,
}: {
  title: string;
  branches: BranchInfo[];
  activeRef: string | null;
  onSelect(refName: string): void;
}) {
  if (branches.length === 0) {
    return null;
  }

  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    () => new Set(),
  );
  const tree = useMemo(
    () =>
      buildRefTree(
        branches.map((branch) => ({
          name: branch.name,
          refName: branch.refName,
          current: branch.current,
          kind: "branch" as const,
        })),
      ),
    [branches],
  );

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
      <div className="branch-group-title">
        <ChevronDown size={14} />
        <span>{title}</span>
      </div>
      {tree.map((node) => (
        <RefTreeNode
          key={node.key}
          node={node}
          activeRef={activeRef}
          depth={0}
          onSelect={onSelect}
          collapsedFolders={collapsedFolders}
          onToggleFolder={toggleFolder}
        />
      ))}
    </div>
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
  onSelect,
  collapsedFolders,
  onToggleFolder,
}: {
  node: RefNode;
  activeRef: string | null;
  depth: number;
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
        {node.leaf.current ? <small>HEAD</small> : null}
      </button>
    );
  }

  const collapsed = collapsedFolders.has(node.key);

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
    <aside className="commit-detail-panel">
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
          <div className="detail-subject">{commit.subject}</div>
          <DetailRow label="Hash" value={commit.hash} mono />
          <DetailRow label="Author" value={commit.author} />
          <DetailRow label="Date" value={formatDate(commit.date)} mono />
          <DetailRow label="Branch" value={branchName ?? "current"} />
          <DetailRow label="Files" value={String(fileCount)} mono />
          <DetailRow label="Selected" value={selectedPath ?? "none"} mono />
        </div>
      ) : (
        <div className="commit-detail-body">
          <div className="detail-subject">Working tree changes</div>
          <DetailRow label="Branch" value={branchName ?? "current"} />
          <DetailRow label="Files" value={String(fileCount)} mono />
          <DetailRow label="Selected" value={selectedPath ?? "none"} mono />
        </div>
      )}
    </aside>
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
      <div className="project-main">
        <button className="project-button" onClick={onSelect}>
          <Boxes size={15} />
          <span>{project.name}</span>
        </button>
        <button className="icon-button" onClick={onRemove} aria-label="Remove">
          <X size={14} />
        </button>
      </div>
      <div className="project-path">{project.activePath}</div>
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

  return (
    <header className="workspace-header">
      <div className="repo-heading">
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
      </div>
    </header>
  );
}

function CommitRow({
  commit,
  active,
  onClick,
}: {
  commit: CommitInfo;
  active: boolean;
  onClick(): void;
}) {
  return (
    <button className={active ? "commit-row active" : "commit-row"} onClick={onClick}>
      <span className="commit-graph-dot" />
      <span className="commit-subject">{commit.subject}</span>
      <span className="commit-author">{commit.author}</span>
      <span className="commit-date">{formatDate(commit.date)}</span>
      <span className="commit-hash">{commit.shortHash}</span>
    </button>
  );
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
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
