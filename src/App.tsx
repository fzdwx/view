import {
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { FileContents } from "@pierre/diffs";
import { UnresolvedFile } from "@pierre/diffs/react";
import {
  AlertTriangle,
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
  Search,
  Save,
  Tag,
  TerminalSquare,
  X,
} from "lucide-react";
import { DiffPanel } from "./components/DiffPanel";
import { TerminalPanel } from "./components/TerminalPanel";
import { TreePanel } from "./components/TreePanel";
import {
  type BranchInfo,
  type CommitInfo,
  type FileContent,
  type RepositoryPayload,
  type SaveConflict,
  type TagInfo,
  type FileSearchResult,
  fetchRemotes,
  getCommits,
  getFileContent,
  getFileDiff,
  getProjectFiles,
  isTauriRuntime,
  loadRepository,
  saveFileContent,
  searchFiles,
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

type PreviewMode = "file" | "diff";
type ToolDock = "left" | "bottom" | "right";
type TreeDock = "left" | "right";
type ProjectDock = TreeDock | "panel";
type EditorDock = "left" | "right";
type GitPanelId = "branches" | "history" | "details";
type ToolPanelId = "project" | "git" | "terminal" | GitPanelId;

const defaultGitPanelOrder: GitPanelId[] = ["branches", "history", "details"];
const layoutStorageKey = "view.workbench-layout.v1";

interface PanelSizes {
  rail: number;
  tree: number;
  log: number;
  branch: number;
  details: number;
  commitInfo: number;
  sideDock: number;
}

interface WorkbenchLayout {
  activityView: ToolPanelId;
  toolDock: ToolDock;
  treeDock: TreeDock;
  projectInToolDock: boolean;
  gitPanelOrder: GitPanelId[];
  detachedGitPanels: GitPanelId[];
  panelSizes: PanelSizes;
}

const defaultPanelSizes: PanelSizes = {
  rail: 292,
  tree: 300,
  log: 280,
  branch: 260,
  details: 280,
  commitInfo: 154,
  sideDock: 420,
};

const defaultWorkbenchLayout: WorkbenchLayout = {
  activityView: "git",
  toolDock: "bottom",
  treeDock: "left",
  projectInToolDock: false,
  gitPanelOrder: defaultGitPanelOrder,
  detachedGitPanels: [],
  panelSizes: defaultPanelSizes,
};

const toolPanels: Array<{
  id: ToolPanelId;
  label: string;
  icon: typeof GitBranch;
}> = [
  { id: "project", label: "Project", icon: Folder },
  { id: "git", label: "Git", icon: GitBranch },
  { id: "terminal", label: "Terminal", icon: TerminalSquare },
];

const gitToolPanels: Array<{
  id: GitPanelId;
  label: string;
  icon: typeof GitBranch;
}> = [
  { id: "branches", label: "Branches", icon: GitBranch },
  { id: "history", label: "History", icon: GitCommitHorizontal },
  { id: "details", label: "Details", icon: GitPullRequestArrow },
];

interface PreviewTab {
  id: string;
  mode: PreviewMode;
  path: string;
  commit: string | null;
}

interface PreviewTarget {
  line: number;
  requestId: number;
}

interface EditorDraft {
  baseContent: string;
  content: string;
  conflict: SaveConflict | null;
}

export function App() {
  const queryClient = useQueryClient();
  const [initialLayout] = useState(loadWorkbenchLayout);
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
  const [previewMode, setPreviewMode] = useState<PreviewMode>("file");
  const [previewTabs, setPreviewTabs] = useState<PreviewTab[]>([]);
  const [activePreviewTabId, setActivePreviewTabId] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);
  const [editorDrafts, setEditorDrafts] = useState<Record<string, EditorDraft>>({});
  const [savePendingKey, setSavePendingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activityView, setActivityView] = useState<ToolPanelId>(
    initialLayout.activityView,
  );
  const [toolPanelCollapsed, setToolPanelCollapsed] = useState(false);
  const [toolDock, setToolDock] = useState<ToolDock>(initialLayout.toolDock);
  const [draggedToolPanel, setDraggedToolPanel] = useState<ToolPanelId | null>(null);
  const [treeDock, setTreeDock] = useState<TreeDock>(initialLayout.treeDock);
  const [projectInToolDock, setProjectInToolDock] = useState(
    initialLayout.projectInToolDock,
  );
  const [draggingTreePanel, setDraggingTreePanel] = useState(false);
  const [draggingEditorPanel, setDraggingEditorPanel] = useState(false);
  const [gitPanelOrder, setGitPanelOrder] = useState<GitPanelId[]>(
    initialLayout.gitPanelOrder,
  );
  const [detachedGitPanels, setDetachedGitPanels] = useState<GitPanelId[]>(
    initialLayout.detachedGitPanels,
  );
  const [draggedGitPanel, setDraggedGitPanel] = useState<GitPanelId | null>(null);
  const [commitFilter, setCommitFilter] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [debouncedCommandQuery, setDebouncedCommandQuery] = useState("");
  const [commandSelectionIndex, setCommandSelectionIndex] = useState(0);
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false);
  const [panelSizes, setPanelSizes] = useState<PanelSizes>(
    initialLayout.panelSizes,
  );
  const remoteFetchInFlightRef = useRef(false);
  const previewRequestIdRef = useRef(0);

  useEffect(() => {
    saveProjects(projects);
  }, [projects]);

  useEffect(() => {
    saveWorkbenchLayout({
      activityView,
      toolDock,
      treeDock,
      projectInToolDock,
      gitPanelOrder,
      detachedGitPanels,
      panelSizes,
    });
  }, [
    activityView,
    detachedGitPanels,
    gitPanelOrder,
    panelSizes,
    projectInToolDock,
    toolDock,
    treeDock,
  ]);

  useEffect(() => {
    window.addEventListener("dragend", clearDockDrag);
    window.addEventListener("drop", clearDockDrag);
    return () => {
      window.removeEventListener("dragend", clearDockDrag);
      window.removeEventListener("drop", clearDockDrag);
    };
  }, []);

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

  const fileSearchQuery = useQuery({
    queryKey: [
      "file-search",
      activeProject?.activePath,
      debouncedCommandQuery,
    ],
    queryFn: () =>
      searchFiles(activeProject!.activePath, debouncedCommandQuery, 80),
    enabled: Boolean(
      activeProject && commandOpen && debouncedCommandQuery.trim(),
    ),
    placeholderData: keepPreviousData,
    retry: false,
  });

  useEffect(() => {
    const payload = repositoryQuery.data;
    if (!payload || !activeProject) {
      return;
    }

    const rootPath = projectRootFromPayload(payload);
    const name = projectNameFromPath(rootPath);
    setProjects((current) => {
      let changed = false;
      const nextProjects = current.map((project) => {
        if (project.id !== activeProject.id) {
          return project;
        }
        if (project.rootPath === rootPath && project.name === name) {
          return project;
        }
        changed = true;
        return {
          ...project,
          rootPath,
          name,
        };
      });

      return changed ? nextProjects : current;
    });
  }, [activeProject?.id, repositoryQuery.data]);

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
  const editorKey =
    activeProject && selectedProjectPath
      ? editorDraftKey(activeProject.activePath, selectedProjectPath)
      : null;
  const activeEditorDraft = editorKey ? editorDrafts[editorKey] ?? null : null;
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
  const commandResults =
    debouncedCommandQuery.trim().length > 0
      ? (fileSearchQuery.data ?? [])
      : [];
  const activeProjectDirtyDraftCount = activeProject
    ? countDirtyDraftsForProject(editorDrafts, activeProject.activePath)
    : 0;
  const dirtyDraftCount = countDirtyDrafts(editorDrafts);
  const dirtyPreviewTabIds = useMemo(() => {
    if (!activeProject) {
      return new Set<string>();
    }

    return new Set(
      previewTabs
        .filter(
          (tab) =>
            tab.mode === "file" &&
            isDraftDirty(editorDrafts[editorDraftKey(activeProject.activePath, tab.path)]),
        )
        .map((tab) => tab.id),
    );
  }, [activeProject, editorDrafts, previewTabs]);
  const appShellStyle = {
    gridTemplateColumns: "56px minmax(0, 1fr)",
  };
  const contentGridStyle: CSSProperties = buildContentGridStyle(
    treeDock,
    toolDock,
    !projectInToolDock,
    panelSizes.tree,
    toolPanelCollapsed ? 36 : panelSizes.log,
    panelSizes.sideDock,
  );
  const editorDock: EditorDock = treeDock === "left" ? "right" : "left";
  const dockedGitPanelOrder = gitPanelOrder.filter(
    (panel) => !detachedGitPanels.includes(panel),
  );
  const gitLogStyle: CSSProperties = buildGitPanelGridStyle(
    toolDock,
    dockedGitPanelOrder,
    panelSizes.branch,
    panelSizes.details,
  );

  useEffect(() => {
    if (!editorKey || !currentFileContent) {
      return;
    }

    setEditorDrafts((current) => {
      const existing = current[editorKey];
      if (existing?.conflict || existing?.content !== existing?.baseContent) {
        return current;
      }
      if (
        existing &&
        existing.baseContent === currentFileContent.content &&
        existing.content === currentFileContent.content
      ) {
        return current;
      }

      return {
        ...current,
        [editorKey]: {
          baseContent: currentFileContent.content,
          content: currentFileContent.content,
          conflict: null,
        },
      };
    });
  }, [currentFileContent, editorKey]);

  useEffect(() => {
    setSaveError(null);
  }, [editorKey]);

  useEffect(() => {
    if (projectFilesQuery.isPlaceholderData) {
      return;
    }

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
  }, [
    projectFilesQuery.data,
    projectFilesQuery.isPlaceholderData,
    selectedProjectPath,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedCommandQuery(commandQuery.trim());
    }, 120);

    return () => window.clearTimeout(timer);
  }, [commandQuery]);

  useEffect(() => {
    setCommandSelectionIndex(0);
  }, [debouncedCommandQuery, activeProject?.activePath]);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      const editableTarget =
        event.target instanceof HTMLElement &&
        (event.target.matches("input, textarea, [contenteditable='true']") ||
          event.target.closest("[data-command-panel]"));

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        if (activeProject) {
          openCommandPanel();
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        if (
          !editableTarget ||
          event.target instanceof HTMLTextAreaElement
        ) {
          event.preventDefault();
          if (previewMode === "file" && activeEditorDraft) {
            void saveActiveFile();
          }
        }
        return;
      }

      if (event.key === "Escape" && commandOpen && !editableTarget) {
        event.preventDefault();
        closeCommandPanel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeEditorDraft, activeProject, commandOpen, previewMode]);

  useEffect(() => {
    if (dirtyDraftCount === 0) {
      return;
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirtyDraftCount]);

  useEffect(() => {
    if (!isTauriRuntime() || dirtyDraftCount === 0) {
      return;
    }

    let unlisten: (() => void) | null = null;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (
          countDirtyDrafts(editorDrafts) > 0 &&
          !window.confirm("You have unsaved file changes. Close View and discard them?")
        ) {
          event.preventDefault();
        }
      })
      .then((nextUnlisten) => {
        unlisten = nextUnlisten;
      });

    return () => {
      unlisten?.();
    };
  }, [dirtyDraftCount, editorDrafts]);

  useEffect(() => {
    if (repositoryQuery.isPlaceholderData) {
      return;
    }

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
      setSelectedChangePath(null);
    }
  }, [payload?.files, repositoryQuery.isPlaceholderData, selectedChangePath]);

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

    if (
      activeProject &&
      activeProject.activePath !== selected &&
      !confirmDiscardProjectDrafts(activeProject.activePath, "open another repository")
    ) {
      return;
    }
    if (activeProject && activeProject.activePath !== selected) {
      discardDraftsForProject(activeProject.activePath);
    }

    setActiveCommit(null);
    setActiveBranchRef(null);
    setSelectedProjectPath(null);
    setSelectedChangePath(null);
    setPreviewMode("file");
    clearPreviewTabs();

    const nextProjects = upsertProject(projects, selected);
    setProjects(nextProjects);
    setActiveProjectId(
      nextProjects.find((project) => project.rootPath === selected)?.id ??
        nextProjects.at(-1)?.id ??
        null,
    );
    setProjectSwitcherOpen(false);
  }

  function removeProject(projectId: string) {
    const project = projects.find((current) => current.id === projectId);
    if (
      project &&
      !confirmDiscardProjectDrafts(project.activePath, `remove ${project.name}`)
    ) {
      return;
    }

    const remaining = projects.filter((project) => project.id !== projectId);
    setProjects(remaining);
    if (project) {
      discardDraftsForProject(project.activePath);
    }
    if (activeProjectId === projectId) {
      setActiveProjectId(remaining[0]?.id ?? null);
      setActiveCommit(null);
      setActiveBranchRef(null);
      setSelectedProjectPath(null);
      setSelectedChangePath(null);
      setPreviewMode("file");
      clearPreviewTabs();
    }
  }

  function selectProject(project: SavedProject) {
    if (
      activeProject &&
      activeProject.id !== project.id &&
      !confirmDiscardProjectDrafts(activeProject.activePath, `switch to ${project.name}`)
    ) {
      return;
    }
    if (activeProject && activeProject.id !== project.id) {
      discardDraftsForProject(activeProject.activePath);
    }

    setActiveProjectId(project.id);
    setProjectSwitcherOpen(false);
    setActiveCommit(null);
    setActiveBranchRef(null);
    setSelectedProjectPath(null);
    setSelectedChangePath(null);
    setPreviewMode("file");
    clearPreviewTabs();
  }

  function clearPreviewTabs() {
    setPreviewTabs([]);
    setActivePreviewTabId(null);
    setPreviewTarget(null);
  }

  function openCommandPanel() {
    setCommandOpen(true);
    setCommandQuery("");
    setDebouncedCommandQuery("");
    setCommandSelectionIndex(0);
  }

  function closeCommandPanel() {
    setCommandOpen(false);
    setCommandQuery("");
    setDebouncedCommandQuery("");
    setCommandSelectionIndex(0);
  }

  function openPreviewTab(mode: PreviewMode, path: string, targetLine: number | null = null) {
    const commit = mode === "diff" ? activeCommit : null;
    const id = previewTabId(mode, path, commit);
    const nextTab: PreviewTab = { id, mode, path, commit };

    setPreviewTabs((tabs) => {
      if (tabs.some((tab) => tab.id === id)) {
        return tabs;
      }
      return [...tabs, nextTab];
    });
    activatePreviewTab(nextTab);
    setPreviewTarget(
      mode === "file" && targetLine
        ? { line: targetLine, requestId: ++previewRequestIdRef.current }
        : null,
    );
  }

  function activatePreviewTab(tab: PreviewTab) {
    setActivePreviewTabId(tab.id);
    setPreviewMode(tab.mode);
    setPreviewTarget(null);

    if (tab.mode === "file") {
      setSelectedProjectPath(tab.path);
      setSelectedChangePath(null);
      return;
    }

    setSelectedProjectPath(null);
    setActiveCommit(tab.commit);
    setSelectedChangePath(tab.path);
  }

  function closePreviewTab(tabId: string) {
    const tab = previewTabs.find((current) => current.id === tabId);
    if (tab?.mode === "file" && activeProject) {
      const key = editorDraftKey(activeProject.activePath, tab.path);
      if (isDraftDirty(editorDrafts[key])) {
        const confirmed = window.confirm(
          `Close ${tab.path} and discard unsaved changes?`,
        );
        if (!confirmed) {
          return;
        }
        setEditorDrafts((current) => omitDraft(current, key));
      }
    }

    const closedIndex = previewTabs.findIndex((tab) => tab.id === tabId);
    const nextTabs = previewTabs.filter((tab) => tab.id !== tabId);
    setPreviewTabs(nextTabs);

    if (activePreviewTabId !== tabId) {
      return;
    }

    const nextTab =
      nextTabs[Math.max(0, closedIndex - 1)] ?? nextTabs[0] ?? null;
    if (nextTab) {
      activatePreviewTab(nextTab);
      return;
    }

    setActivePreviewTabId(null);
    setSelectedProjectPath(null);
    setSelectedChangePath(null);
    setPreviewMode("file");
    setPreviewTarget(null);
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

  function openFileSearchResult(result: FileSearchResult) {
    openPreviewTab("file", result.path, result.lineNumber);
    closeCommandPanel();
  }

  function dockToolPanel(panel: ToolPanelId, dock: ToolDock) {
    if (panel === "project") {
      setProjectInToolDock(true);
    } else if (isGitPanelId(panel)) {
      setDetachedGitPanels((current) =>
        current.includes(panel) ? current : [...current, panel],
      );
    }
    setActivityView(panel);
    setToolPanelCollapsed(false);
    setToolDock(dock);
    clearDockDrag();
  }

  function startToolPanelDrag(panel: ToolPanelId) {
    setDraggedToolPanel(panel);
    if (isGitPanelId(panel)) {
      setDraggedGitPanel(panel);
    }
  }

  function endToolPanelDrag() {
    clearDockDrag();
  }

  function dockProjectPanel(nextDock: ProjectDock) {
    if (nextDock === "panel") {
      setProjectInToolDock(true);
      setActivityView("project");
      setToolPanelCollapsed(false);
      setToolDock("bottom");
      clearDockDrag();
      return;
    }

    setProjectInToolDock(false);
    setTreeDock(nextDock);
    if (activityView === "project") {
      setActivityView("git");
      setToolPanelCollapsed(false);
    }
    clearDockDrag();
  }

  function selectToolPanelView(view: ToolPanelId) {
    if (toolDock === "bottom" && activityView === view) {
      setToolPanelCollapsed((collapsed) => !collapsed);
      return;
    }

    setActivityView(view);
    setToolPanelCollapsed(false);
  }

  function dockEditorPanel(nextDock: EditorDock) {
    setTreeDock(nextDock === "left" ? "right" : "left");
    clearDockDrag();
  }

  function clearDockDrag() {
    setDraggedToolPanel(null);
    setDraggedGitPanel(null);
    setDraggingTreePanel(false);
    setDraggingEditorPanel(false);
  }

  function moveGitPanel(panel: GitPanelId, targetPanel: GitPanelId) {
    setDetachedGitPanels((current) => current.filter((item) => item !== panel));
    setGitPanelOrder((current) => {
      if (panel === targetPanel) {
        return current;
      }

      const nextOrder = current.filter((item) => item !== panel);
      const targetIndex = nextOrder.indexOf(targetPanel);
      if (targetIndex === -1) {
        return current;
      }

      nextOrder.splice(targetIndex, 0, panel);
      return nextOrder;
    });
    if (activityView === panel) {
      setActivityView("git");
      setToolPanelCollapsed(false);
    }
    clearDockDrag();
  }

  function reattachGitPanel(panel: GitPanelId) {
    setDetachedGitPanels((current) => current.filter((item) => item !== panel));
    if (activityView === panel) {
      setActivityView("git");
      setToolPanelCollapsed(false);
    }
    clearDockDrag();
  }

  function updateEditorDraft(content: string) {
    if (!editorKey || !currentFileContent) {
      return;
    }

    setEditorDrafts((current) => {
      const existing = current[editorKey] ?? {
        baseContent: currentFileContent.content,
        content: currentFileContent.content,
        conflict: null,
      };

      return {
        ...current,
        [editorKey]: {
          ...existing,
          content,
        },
      };
    });
    setSaveError(null);
  }

  function setConflictDraftContent(content: string) {
    if (!editorKey) {
      return;
    }

    setEditorDrafts((current) => {
      const existing = current[editorKey];
      if (!existing) {
        return current;
      }

      return {
        ...current,
        [editorKey]: {
          ...existing,
          content,
        },
      };
    });
    setSaveError(null);
  }

  async function saveActiveFile() {
    if (!activeProject || !selectedProjectPath || !editorKey) {
      return;
    }

    const draft = editorDrafts[editorKey];
    if (!draft) {
      return;
    }

    setSavePendingKey(editorKey);
    setSaveError(null);
    try {
      const baseContent = draft.conflict
        ? draft.conflict.currentContent
        : draft.baseContent;
      const response = await saveFileContent(
        activeProject.activePath,
        selectedProjectPath,
        baseContent,
        draft.content,
      );

      if (response.status === "conflict" && response.conflict) {
        setEditorDrafts((current) => ({
          ...current,
          [editorKey]: {
            baseContent: response.conflict!.baseContent,
            content: response.conflict!.proposedContent,
            conflict: response.conflict!,
          },
        }));
        return;
      }

      if (response.file) {
        setEditorDrafts((current) => ({
          ...current,
          [editorKey]: {
            baseContent: response.file!.content,
            content: response.file!.content,
            conflict: null,
          },
        }));
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: ["file-content", activeProject.activePath, selectedProjectPath],
          }),
          queryClient.invalidateQueries({
            queryKey: ["project-files", activeProject.activePath],
          }),
          queryClient.invalidateQueries({
            queryKey: ["repository", activeProject.activePath],
          }),
        ]);
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavePendingKey(null);
    }
  }

  function discardConflictToDisk() {
    if (!editorKey) {
      return;
    }

    setEditorDrafts((current) => {
      const existing = current[editorKey];
      if (!existing?.conflict) {
        return current;
      }

      return {
        ...current,
        [editorKey]: {
          baseContent: existing.conflict.currentContent,
          content: existing.conflict.currentContent,
          conflict: null,
        },
      };
    });
    setSaveError(null);
  }

  function confirmDiscardProjectDrafts(projectPath: string, action: string): boolean {
    const dirtyCount = countDirtyDraftsForProject(editorDrafts, projectPath);
    if (dirtyCount === 0) {
      return true;
    }

    return window.confirm(
      `${dirtyCount} file${dirtyCount > 1 ? "s have" : " has"} unsaved changes. Continue to ${action} and discard them?`,
    );
  }

  function discardDraftsForProject(projectPath: string) {
    setEditorDrafts((current) => omitDraftsForProject(current, projectPath));
  }

  const gitPanelBodies: Record<GitPanelId, ReactNode> = {
    branches: (
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
              setActivePreviewTabId(null);
            }}
          />
        ) : (
          <LoadingRows />
        )}
      </section>
    ),
    history: (
      <section className="history-panel">
        <VirtualCommitList
          commits={filteredCommits}
          activeCommit={activeCommit}
          filter={commitFilter}
          loading={commitsQuery.isLoading}
          onChangeFilter={setCommitFilter}
          onSelectCommit={(hash) => {
            setActiveCommit(hash);
            setSelectedChangePath(null);
            setPreviewMode("diff");
            setActivePreviewTabId(null);
          }}
          onSelectWorkingTree={() => {
            setActiveCommit(null);
            setSelectedChangePath(null);
            setPreviewMode("diff");
            setActivePreviewTabId(null);
          }}
        />
      </section>
    ),
    details: (
      <CommitInspector
        branchName={
          payload?.summary.branches.find(
            (branch) => branch.refName === selectedBranchRef,
          )?.name ??
          payload?.summary.tags.find((tag) => tag.refName === selectedBranchRef)
            ?.name ??
          payload?.summary.branch
        }
        commit={selectedCommit}
        files={payload?.files ?? []}
        detailHeight={panelSizes.commitInfo}
        selectedPath={selectedChangePath}
        onResizeDetails={(delta) => resizePanel("commitInfo", -delta, 110, 360)}
        onSelectPath={(path) => {
          openPreviewTab("diff", path);
        }}
      />
    ),
  };

  const projectTreeContent = (
    <section className="tree-panel">
      {projectFilesQuery.data ? (
        <TreePanel
          files={projectFilesQuery.data}
          selectedPath={selectedProjectPath}
          title={
            activeProject ? (
              <ProjectTreeTitle path={activeProject.activePath} />
            ) : (
              "Project"
            )
          }
          emptyTitle="No project files"
          emptyCopy="Tracked and untracked files will appear here."
          onDragEnd={clearDockDrag}
          onDragStart={() => setDraggingTreePanel(true)}
          onSelectPath={(path) => {
            openPreviewTab("file", path);
          }}
        />
      ) : (
        <LoadingRows />
      )}
    </section>
  );

  const gitPanelContent = (
    <section className="git-log-panel" style={gitLogStyle}>
      {dockedGitPanelOrder.length === 0 ? (
        <div
          className={
            draggedGitPanel ? "git-panel-empty can-drop" : "git-panel-empty"
          }
          onDragOver={(event) => {
            if (!draggedGitPanel) {
              return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            event.preventDefault();
            const panel =
              (event.dataTransfer.getData(
                "application/x-view-git-panel",
              ) as GitPanelId) || draggedGitPanel;
            if (isGitPanelId(panel)) {
              reattachGitPanel(panel);
            }
          }}
        >
          All Git panels are docked as tabs.
        </div>
      ) : null}
      {dockedGitPanelOrder.map((panelId, index) => (
        <FragmentWithSplitter
          key={panelId}
          index={index}
          panelCount={dockedGitPanelOrder.length}
          dock={toolDock}
          onResizeFirst={(delta) =>
            resizePanel("branch", delta, toolDock === "bottom" ? 180 : 120, 460)
          }
          onResizeSecond={(delta) =>
            resizePanel("details", -delta, toolDock === "bottom" ? 200 : 120, 460)
          }
        >
          <GitPanelSlot
            panelId={panelId}
            draggingPanel={draggedGitPanel}
            onDropPanel={moveGitPanel}
            onDragEnd={clearDockDrag}
            onDragStart={setDraggedGitPanel}
          >
            {gitPanelBodies[panelId]}
          </GitPanelSlot>
        </FragmentWithSplitter>
      ))}
    </section>
  );

  const nonTerminalToolPanelContent =
    activityView === "project"
      ? projectTreeContent
      : isGitPanelId(activityView)
        ? (
            <ToolContentFrame
              label={gitPanelLabel(activityView)}
              panelId={activityView}
              onDragEnd={clearDockDrag}
              onDragStart={startToolPanelDrag}
            >
              <section className="detached-git-panel">
                {gitPanelBodies[activityView]}
              </section>
            </ToolContentFrame>
          )
      : activityView === "git"
        ? gitPanelContent
        : null;
  const toolPanelContent = (
    <div className="tool-panel-stack">
      <div
        className={
          activityView === "terminal"
            ? "tool-panel-layer tool-panel-layer-hidden"
            : "tool-panel-layer"
        }
        aria-hidden={activityView === "terminal"}
      >
        {nonTerminalToolPanelContent}
      </div>
      <section
        className={
          activityView === "terminal"
            ? "bottom-terminal-panel tool-panel-layer"
            : "bottom-terminal-panel tool-panel-layer tool-panel-layer-hidden"
        }
        aria-hidden={activityView !== "terminal"}
      >
        <TerminalPanel
          active={activityView === "terminal"}
          projectPath={activeProject?.activePath ?? null}
        />
      </section>
    </div>
  );
  const visibleToolPanels = [
    ...(projectInToolDock
      ? toolPanels
      : toolPanels.filter((panel) => panel.id !== "project")),
    ...gitToolPanels.filter((panel) => detachedGitPanels.includes(panel.id)),
  ];

  return (
    <main className="app-shell" style={appShellStyle}>
      <aside className="project-rail" aria-label="Projects">
        <div className="brand-row">
          <div className="brand-mark">
            <GitPullRequestArrow size={18} />
          </div>
        </div>

        <div className="project-switcher-anchor">
          <button
            className={
              projectSwitcherOpen
                ? "activity-button rail-project-button active"
                : "activity-button rail-project-button"
            }
            aria-expanded={projectSwitcherOpen}
            aria-haspopup="dialog"
            aria-label="Switch project"
            title={activeProject ? activeProject.name : "Switch project"}
            onClick={() => setProjectSwitcherOpen((open) => !open)}
          >
            <FolderOpen size={18} />
          </button>
          {projectSwitcherOpen ? (
            <ProjectSwitcherPopover
              projects={projects}
              activeProjectId={activeProjectId}
              onChooseRepository={chooseRepository}
              onClose={() => setProjectSwitcherOpen(false)}
              onRemoveProject={removeProject}
              onSelectProject={selectProject}
            />
          ) : null}
        </div>

        <div className="rail-spacer" />
      </aside>

      <section className="workspace">
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
          <div
            className={`content-grid dock-${toolDock} tree-dock-${treeDock}${
              draggedToolPanel ||
              draggedGitPanel ||
              draggingTreePanel ||
              draggingEditorPanel
                ? " is-docking"
                : ""
            }`}
            style={contentGridStyle}
          >
            {!projectInToolDock ? (
              <>
                {projectTreeContent}
                <ResizeHandle
                  axis="x"
                  className="tree-diff-splitter"
                  label="Resize file tree panel"
                  onResize={(delta) =>
                    resizePanel("tree", treeDock === "left" ? delta : -delta, 220, 560)
                  }
                />
              </>
            ) : null}

            <section className="diff-panel">
              <PreviewTabBar
                activeTabId={activePreviewTabId}
                diffStats={diffStats}
                loading={
                  repositoryQuery.isFetching ||
                  fileDiffQuery.isFetching ||
                  fileContentQuery.isFetching
                }
                onCloseTab={closePreviewTab}
                onDragEnd={clearDockDrag}
                onDragStart={() => setDraggingEditorPanel(true)}
                onSelectTab={activatePreviewTab}
                previewMode={previewMode}
                selectedPath={
                  previewMode === "diff" ? selectedChangePath : selectedProjectPath
                }
                tabs={previewTabs}
                dirtyTabIds={dirtyPreviewTabIds}
              />
              {previewMode === "file" ? (
                <FilePreview
                  draft={activeEditorDraft}
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
                  saveError={saveError}
                  saving={Boolean(editorKey && savePendingKey === editorKey)}
                  selectedPath={selectedProjectPath}
                  target={previewTarget}
                  onChangeDraft={updateEditorDraft}
                  onDiscardConflict={discardConflictToDisk}
                  onSave={() => void saveActiveFile()}
                  onSetConflictDraftContent={setConflictDraftContent}
                />
              ) : payload && !selectedChangePath ? (
                <div className="empty-state">
                  <div className="empty-title">Select a changed file</div>
                  <div className="empty-copy">
                    Choose a file from Changes to render its diff.
                  </div>
                </div>
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
            {toolDock === "bottom" ? (
              <>
                <ResizeHandle
                  axis="y"
                  className="main-log-splitter"
                  label="Resize tool panel"
                  onResize={(delta) => resizePanel("log", -delta, 180, 560)}
                />
                <ToolDockPanel
                  activeView={activityView}
                  collapsed={toolPanelCollapsed}
                  dock="bottom"
                  panels={visibleToolPanels}
                  onDragEnd={endToolPanelDrag}
                  onDragStart={startToolPanelDrag}
                  onSelectView={selectToolPanelView}
                >
                  {toolPanelContent}
                </ToolDockPanel>
              </>
            ) : (
              <>
                <ResizeHandle
                  axis="x"
                  className="side-dock-splitter"
                  label="Resize tool panel"
                  onResize={(delta) =>
                    resizePanel(
                      "sideDock",
                      toolDock === "left" ? delta : -delta,
                      320,
                      620,
                    )
                  }
                />
                <ToolDockPanel
                  activeView={activityView}
                  collapsed={toolPanelCollapsed}
                  dock={toolDock}
                  panels={visibleToolPanels}
                  onDragEnd={endToolPanelDrag}
                  onDragStart={startToolPanelDrag}
                  onSelectView={selectToolPanelView}
                >
                  {toolPanelContent}
                </ToolDockPanel>
              </>
            )}
            {draggedToolPanel ||
            draggedGitPanel ||
            draggingTreePanel ||
            draggingEditorPanel ? (
              <WorkbenchDockOverlay
                activeEditorDock={editorDock}
                activeProjectDock={projectInToolDock ? "panel" : treeDock}
                activeToolDock={toolDock}
                draggedGitPanel={draggedGitPanel}
                draggedToolPanel={draggedToolPanel}
                draggingEditorPanel={draggingEditorPanel}
                draggingTreePanel={draggingTreePanel}
                onDockEditor={dockEditorPanel}
                onDockProject={dockProjectPanel}
                onDockTool={dockToolPanel}
              />
            ) : null}
          </div>
        )}
      </section>
      <CommandPanel
        activeIndex={commandSelectionIndex}
        error={
          fileSearchQuery.isError
            ? String(fileSearchQuery.error.message)
            : null
        }
        loading={fileSearchQuery.isFetching}
        open={commandOpen}
        projectName={activeProject?.name}
        query={commandQuery}
        results={commandResults}
        onChangeQuery={setCommandQuery}
        onClose={closeCommandPanel}
        onOpenResult={openFileSearchResult}
        onSelectIndex={setCommandSelectionIndex}
      />
    </main>
  );
}

function ToolDockPanel({
  activeView,
  children,
  collapsed,
  dock,
  panels,
  onDragEnd,
  onDragStart,
  onSelectView,
}: {
  activeView: ToolPanelId;
  children: ReactNode;
  collapsed: boolean;
  dock: ToolDock;
  panels: typeof toolPanels;
  onDragEnd(): void;
  onDragStart(panel: ToolPanelId): void;
  onSelectView(view: ToolPanelId): void;
}) {
  return (
    <section
      className={
        collapsed
          ? `tool-dock-panel tool-dock-${dock} collapsed`
          : `tool-dock-panel tool-dock-${dock}`
      }
    >
      <div className="tool-dock-content" aria-hidden={collapsed}>
        {children}
      </div>
      <nav className="tool-dock-tabs" aria-label="Tool panel views">
        <div className="tool-tab-group">
          {panels.map((panel) => {
            const Icon = panel.icon;
            return (
              <button
                key={panel.id}
                className={
                  activeView === panel.id
                    ? "activity-button active"
                    : "activity-button"
                }
                aria-label={`${panel.label} view`}
                title={`${panel.label}, drag to dock`}
                draggable
                onClick={() => onSelectView(panel.id)}
                onDragEnd={onDragEnd}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(
                    "application/x-view-tool-panel",
                    panel.id,
                  );
                  if (isGitPanelId(panel.id)) {
                    event.dataTransfer.setData(
                      "application/x-view-git-panel",
                      panel.id,
                    );
                  }
                  onDragStart(panel.id);
                }}
              >
                <Icon size={19} />
              </button>
            );
          })}
        </div>
      </nav>
    </section>
  );
}

function ToolContentFrame({
  children,
  label,
  panelId,
  onDragEnd,
  onDragStart,
}: {
  children: ReactNode;
  label: string;
  panelId: ToolPanelId;
  onDragEnd(): void;
  onDragStart(panel: ToolPanelId): void;
}) {
  return (
    <section className="tool-content-frame">
      <div
        className="tool-content-dragbar"
        draggable
        title={`Drag ${label} panel`}
        onDragEnd={onDragEnd}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-view-tool-panel", panelId);
          if (isGitPanelId(panelId)) {
            event.dataTransfer.setData("application/x-view-git-panel", panelId);
          }
          onDragStart(panelId);
        }}
      >
        <span>{label}</span>
      </div>
      <div className="tool-content-frame-body">{children}</div>
    </section>
  );
}

function FragmentWithSplitter({
  children,
  dock,
  index,
  panelCount,
  onResizeFirst,
  onResizeSecond,
}: {
  children: ReactNode;
  dock: ToolDock;
  index: number;
  panelCount: number;
  onResizeFirst(delta: number): void;
  onResizeSecond(delta: number): void;
}) {
  return (
    <>
      {children}
      {index < panelCount - 1 ? (
        <ResizeHandle
          axis={dock === "bottom" ? "x" : "y"}
          className={`git-panel-splitter-${index + 1}`}
          label="Resize Git panel"
          onResize={index === 0 ? onResizeFirst : onResizeSecond}
        />
      ) : null}
    </>
  );
}

function GitPanelSlot({
  children,
  draggingPanel,
  onDragEnd,
  onDragStart,
  onDropPanel,
  panelId,
}: {
  children: ReactNode;
  draggingPanel: GitPanelId | null;
  onDragEnd(): void;
  onDragStart(panel: GitPanelId): void;
  onDropPanel(panel: GitPanelId, targetPanel: GitPanelId): void;
  panelId: GitPanelId;
}) {
  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (!draggingPanel) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const panel =
      (event.dataTransfer.getData("application/x-view-git-panel") as GitPanelId) ||
      draggingPanel;
    if (panel === "branches" || panel === "history" || panel === "details") {
      onDropPanel(panel, panelId);
    }
  }

  return (
    <section
      className={
        draggingPanel && draggingPanel !== panelId
          ? "git-panel-slot can-drop"
          : "git-panel-slot"
      }
      style={{ gridArea: panelId }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div
        className="git-panel-grab-edge"
        draggable
        title={`Drag ${gitPanelLabel(panelId)} panel`}
        onDragEnd={onDragEnd}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-view-git-panel", panelId);
          onDragStart(panelId);
        }}
      />
      <div className="git-panel-slot-body">{children}</div>
    </section>
  );
}

function WorkbenchDockOverlay({
  activeEditorDock,
  activeProjectDock,
  activeToolDock,
  draggedGitPanel,
  draggedToolPanel,
  draggingEditorPanel,
  draggingTreePanel,
  onDockEditor,
  onDockProject,
  onDockTool,
}: {
  activeEditorDock: EditorDock;
  activeProjectDock: ProjectDock;
  activeToolDock: ToolDock;
  draggedGitPanel: GitPanelId | null;
  draggedToolPanel: ToolPanelId | null;
  draggingEditorPanel: boolean;
  draggingTreePanel: boolean;
  onDockEditor(dock: EditorDock): void;
  onDockProject(dock: ProjectDock): void;
  onDockTool(panel: ToolPanelId, dock: ToolDock): void;
}) {
  const draggingTool = Boolean(draggedToolPanel || draggedGitPanel);

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function getDraggedToolPanel(event: DragEvent<HTMLDivElement>) {
    const gitPanel = event.dataTransfer.getData(
      "application/x-view-git-panel",
    ) as GitPanelId;
    if (isGitPanelId(gitPanel)) {
      return gitPanel;
    }

    const toolPanel = event.dataTransfer.getData(
      "application/x-view-tool-panel",
    ) as ToolPanelId;
    if (
      toolPanel === "project" ||
      toolPanel === "git" ||
      toolPanel === "terminal" ||
      isGitPanelId(toolPanel)
    ) {
      return toolPanel;
    }

    return draggedToolPanel ?? draggedGitPanel;
  }

  function handleToolDrop(nextDock: ToolDock) {
    return (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const panel = getDraggedToolPanel(event);
      if (panel) {
        onDockTool(panel, nextDock);
      }
    };
  }

  function handleProjectDrop(nextDock: ProjectDock) {
    return (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      onDockProject(nextDock);
    };
  }

  function handleEditorDrop(nextDock: EditorDock) {
    return (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      onDockEditor(nextDock);
    };
  }

  return (
    <div className="workbench-dock-overlay" aria-hidden="true">
      {draggingTool ? (
        <>
          <div
            className={
              activeToolDock === "left"
                ? "dock-drop-zone dock-drop-left active"
                : "dock-drop-zone dock-drop-left"
            }
            onDragOver={handleDragOver}
            onDrop={handleToolDrop("left")}
          />
          <div
            className={
              activeToolDock === "bottom"
                ? "dock-drop-zone dock-drop-bottom active"
                : "dock-drop-zone dock-drop-bottom"
            }
            onDragOver={handleDragOver}
            onDrop={handleToolDrop("bottom")}
          />
          <div
            className={
              activeToolDock === "right"
                ? "dock-drop-zone dock-drop-right active"
                : "dock-drop-zone dock-drop-right"
            }
            onDragOver={handleDragOver}
            onDrop={handleToolDrop("right")}
          />
        </>
      ) : null}

      {draggingTreePanel ? (
        <>
          <div
            className={
              activeProjectDock === "left"
                ? "dock-drop-zone dock-drop-left active"
                : "dock-drop-zone dock-drop-left"
            }
            onDragOver={handleDragOver}
            onDrop={handleProjectDrop("left")}
          />
          <div
            className={
              activeProjectDock === "panel"
                ? "dock-drop-zone dock-drop-center active"
                : "dock-drop-zone dock-drop-center"
            }
            onDragOver={handleDragOver}
            onDrop={handleProjectDrop("panel")}
          />
          <div
            className={
              activeProjectDock === "right"
                ? "dock-drop-zone dock-drop-right active"
                : "dock-drop-zone dock-drop-right"
            }
            onDragOver={handleDragOver}
            onDrop={handleProjectDrop("right")}
          />
        </>
      ) : null}

      {draggingEditorPanel ? (
        <>
          <div
            className={
              activeEditorDock === "left"
                ? "dock-drop-zone dock-drop-left active"
                : "dock-drop-zone dock-drop-left"
            }
            onDragOver={handleDragOver}
            onDrop={handleEditorDrop("left")}
          />
          <div
            className={
              activeEditorDock === "right"
                ? "dock-drop-zone dock-drop-right active"
                : "dock-drop-zone dock-drop-right"
            }
            onDragOver={handleDragOver}
            onDrop={handleEditorDrop("right")}
          />
        </>
      ) : null}
    </div>
  );
}

function FilePreview({
  draft,
  error,
  file,
  loading,
  saveError,
  saving,
  selectedPath,
  target,
  onChangeDraft,
  onDiscardConflict,
  onSave,
  onSetConflictDraftContent,
}: {
  draft: EditorDraft | null;
  error: string | null;
  file: FileContent | null;
  loading: boolean;
  saveError: string | null;
  saving: boolean;
  selectedPath: string | null;
  target: PreviewTarget | null;
  onChangeDraft(content: string): void;
  onDiscardConflict(): void;
  onSave(): void;
  onSetConflictDraftContent(content: string): void;
}) {
  const frameRef = useRef<HTMLElement | null>(null);
  const targetLineRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const content = draft?.content ?? file?.content ?? "";
  const conflict = draft?.conflict ?? null;
  const lines = useMemo(() => {
    if (!content) {
      return [];
    }

    return content.length > 0 ? content.split(/\r?\n/) : [""];
  }, [content]);

  useLayoutEffect(() => {
    if (!target || !file) {
      return;
    }

    const frame = frameRef.current;
    const line = targetLineRef.current;
    if (!frame || !line) {
      return;
    }

    const frameRect = frame.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const nextTop =
      frame.scrollTop +
      lineRect.top -
      frameRect.top -
      (frame.clientHeight - lineRect.height) / 2;

    frame.scrollTo({
      top: Math.max(0, nextTop),
      left: frame.scrollLeft,
      behavior: "auto",
    });
  }, [content, file, target]);

  useLayoutEffect(() => {
    if (!target || !textareaRef.current) {
      return;
    }

    const lineHeight = 19;
    textareaRef.current.scrollTop = Math.max(0, (target.line - 1) * lineHeight - 120);
  }, [target]);

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

  if (conflict) {
    return (
      <section className="merge-page" aria-label={`Merge ${file.path}`}>
        <div className="editor-toolbar conflict-toolbar">
          <div className="editor-status conflict">
            <AlertTriangle size={14} />
            <span>File changed on disk</span>
          </div>
          <div className="editor-actions">
            <button
              className="ghost-button"
              onClick={() => onSetConflictDraftContent(conflict.currentContent)}
            >
              Use disk
            </button>
            <button
              className="ghost-button"
              onClick={() => onSetConflictDraftContent(conflict.proposedContent)}
            >
              Use mine
            </button>
            <button className="ghost-button" onClick={onDiscardConflict}>
              Reload disk
            </button>
            <button className="primary-action editor-save" disabled={saving} onClick={onSave}>
              {saving ? <Loader2 className="spin" size={14} /> : <Save size={14} />}
              Save merge
            </button>
          </div>
        </div>
        <div className="merge-diff-frame">
          <UnresolvedFile
            file={conflictToMarkerFile(conflict)}
            className="diff-view merge-conflict-view"
            options={{
              mergeConflictActionsType: "none",
              overflow: "scroll",
              tokenizeMaxLineLength: 400,
              theme: {
                light: "pierre-light",
                dark: "pierre-dark",
              },
              themeType: "dark",
            }}
          />
        </div>
        <textarea
          ref={textareaRef}
          className="file-editor merge-editor"
          spellCheck={false}
          value={content}
          onChange={(event) => onChangeDraft(event.target.value)}
        />
        {saveError ? <div className="editor-error">{saveError}</div> : null}
      </section>
    );
  }

  return (
    <section className="file-editor-shell" aria-label={file.path}>
      {target ? (
        <section ref={frameRef} className="file-preview-frame target-preview" aria-hidden="true">
          <div className="file-preview-code" role="presentation">
            {lines.map((line, index) => {
              const lineNumber = index + 1;
              const active = target.line === lineNumber;

              return (
                <div
                  key={lineNumber}
                  ref={active ? targetLineRef : undefined}
                  className={active ? "file-preview-line active" : "file-preview-line"}
                >
                  <span className="file-preview-line-number">{lineNumber}</span>
                  <span className="file-preview-line-code">
                    {line.length > 0 ? line : " "}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
      <textarea
        ref={textareaRef}
        className="file-editor"
        spellCheck={false}
        value={content}
        onChange={(event) => onChangeDraft(event.target.value)}
      />
      {saveError ? <div className="editor-error">{saveError}</div> : null}
    </section>
  );
}

function PreviewTabBar({
  activeTabId,
  diffStats,
  dirtyTabIds,
  loading,
  onCloseTab,
  onDragEnd,
  onDragStart,
  onSelectTab,
  previewMode,
  selectedPath,
  tabs,
}: {
  activeTabId: string | null;
  diffStats: { additions: number; deletions: number; files: number };
  dirtyTabIds: Set<string>;
  loading: boolean;
  onCloseTab(tabId: string): void;
  onDragEnd(): void;
  onDragStart(): void;
  onSelectTab(tab: PreviewTab): void;
  previewMode: PreviewMode;
  selectedPath: string | null;
  tabs: PreviewTab[];
}) {
  return (
    <div className="preview-tabbar">
      <div className="preview-tabs" role="tablist" aria-label="Open files">
        {tabs.length > 0 ? (
          tabs.map((tab) => (
            <div
              key={tab.id}
              className={
                tab.id === activeTabId ? "preview-tab active" : "preview-tab"
              }
              title={tab.path}
            >
              <button
                className="preview-tab-select"
                role="tab"
                aria-selected={tab.id === activeTabId}
                onClick={() => onSelectTab(tab)}
              >
                <span className="preview-tab-kind">
                  {tab.mode === "diff" ? "D" : "F"}
                </span>
                <span className="preview-tab-name">{fileNameFromPath(tab.path)}</span>
                {dirtyTabIds.has(tab.id) ? (
                  <span className="preview-tab-dirty" aria-label="Unsaved changes" />
                ) : null}
              </button>
              <button
                className="preview-tab-close"
                aria-label={`Close ${tab.path}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTab(tab.id);
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))
        ) : (
          <div className="preview-tab-placeholder">
            {selectedPath
              ? `${previewMode === "diff" ? "Diff" : "File"}: ${fileNameFromPath(
                  selectedPath,
                )}`
              : "No file open"}
          </div>
        )}
      </div>
      <div className="preview-tabbar-meta">
        <div
          className="editor-dock-handle"
          draggable
          title="Drag editor group"
          onDragEnd={onDragEnd}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("application/x-view-panel", "editor");
            onDragStart();
          }}
        >
          Editor
        </div>
        {previewMode === "diff" && diffStats.files > 0 ? (
          <div className="diff-stat-strip" aria-label="Diff line counts">
            <span className="addition">+{diffStats.additions}</span>
            <span className="deletion">-{diffStats.deletions}</span>
          </div>
        ) : null}
        {loading ? <Loader2 className="spin" size={15} /> : null}
      </div>
    </div>
  );
}

function ProjectTreeTitle({ path }: { path: string }) {
  const { parent, name } = splitProjectPath(path);

  return (
    <span className="project-tree-title" title={path}>
      {parent ? <span className="project-tree-parent">{parent}/</span> : null}
      <span className="project-tree-name">{name}</span>
    </span>
  );
}

function splitProjectPath(path: string): { parent: string; name: string } {
  const normalized = path.replace(/\/+$/, "") || path;
  const parts = normalized.split("/").filter(Boolean);
  const name = parts.at(-1) ?? normalized;
  const parentParts = parts.slice(0, -1);
  const parent =
    normalized.startsWith("/") && parentParts.length > 0
      ? `/${parentParts.join("/")}`
      : parentParts.join("/");

  return { parent, name };
}

function CommandPanel({
  activeIndex,
  error,
  loading,
  open,
  projectName,
  query,
  results,
  onChangeQuery,
  onClose,
  onOpenResult,
  onSelectIndex,
}: {
  activeIndex: number;
  error: string | null;
  loading: boolean;
  open: boolean;
  projectName?: string;
  query: string;
  results: FileSearchResult[];
  onChangeQuery(query: string): void;
  onClose(): void;
  onOpenResult(result: FileSearchResult): void;
  onSelectIndex(index: number): void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasQuery = query.trim().length > 0;

  useEffect(() => {
    if (!open) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  if (!open) {
    return null;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      onSelectIndex(results.length === 0 ? 0 : (activeIndex + 1) % results.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      onSelectIndex(
        results.length === 0
          ? 0
          : (activeIndex - 1 + results.length) % results.length,
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const selected = results[activeIndex];
      if (selected) {
        onOpenResult(selected);
      }
    }
  }

  return (
    <div className="command-overlay" data-command-panel onMouseDown={onClose}>
      <section
        className="command-panel"
        aria-label="Command panel"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="command-input-row">
          <Search size={17} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onChangeQuery(event.target.value)}
            placeholder="Search files"
          />
          {loading ? <Loader2 className="spin" size={16} /> : null}
        </div>
        <div className="command-context">
          <span>{projectName ?? "No project"}</span>
          <kbd>Enter</kbd>
          <kbd>Esc</kbd>
        </div>
        <div className="command-results">
          {error ? (
            <div className="command-empty">
              <div className="empty-title">Search failed</div>
              <div className="empty-copy">{error}</div>
            </div>
          ) : !hasQuery ? (
            <div className="command-empty">
              <div className="empty-title">Type a file name or path</div>
              <div className="empty-copy">
                Fuzzy search scans tracked and untracked files in the active worktree.
              </div>
            </div>
          ) : results.length === 0 && !loading ? (
            <div className="command-empty">
              <div className="empty-title">No files found</div>
              <div className="empty-copy">Try another filename or path segment.</div>
            </div>
          ) : (
            results.map((result, index) => {
              const hasLineMatch = Boolean(result.lineNumber && result.lineText);

              return (
                <button
                  key={`${result.path}:${result.lineNumber ?? "file"}`}
                  className={
                    index === activeIndex
                      ? "command-result active"
                      : "command-result"
                  }
                  onMouseEnter={() => onSelectIndex(index)}
                  onClick={() => onOpenResult(result)}
                >
                  <span className="command-result-icon">
                    {fileExtension(result.path) || "file"}
                  </span>
                  <span className="command-result-main">
                    <span>{fileNameFromPath(result.path)}</span>
                    <small className={hasLineMatch ? "command-result-match" : undefined}>
                      {hasLineMatch
                        ? `${result.lineNumber}: ${result.lineText}`
                        : parentPathFromPath(result.path) || "./"}
                    </small>
                  </span>
                  <span className="command-result-score">
                    {hasLineMatch ? "line" : result.score}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>
    </div>
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
  const refCountLabel = branchFilter.trim()
    ? `${visibleRefCount} / ${refCount}`
    : `${refCount}`;

  return (
    <div className="branch-tree">
      <label className="search-field branch-search">
        <Search size={15} />
        <input
          value={branchFilter}
          onChange={(event) => setBranchFilter(event.target.value)}
          placeholder="Filter branches"
        />
        <span className="search-count">{refCountLabel}</span>
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
  detailHeight,
  files,
  selectedPath,
  onResizeDetails,
  onSelectPath,
}: {
  commit: CommitInfo | null;
  branchName?: string;
  detailHeight: number;
  files: RepositoryPayload["files"];
  selectedPath: string | null;
  onResizeDetails(delta: number): void;
  onSelectPath(path: string): void;
}) {
  return (
    <aside
      className="commit-detail-panel"
      style={{
        gridTemplateRows: `minmax(0, 1fr) 6px ${detailHeight}px`,
      }}
    >
      <div className="commit-changes-panel">
        <TreePanel
          files={files}
          selectedPath={selectedPath}
          title="Changes"
          showHeader={false}
          initialExpansion="open"
          emptyTitle="No changed files"
          emptyCopy="Select a commit with file changes, or inspect working tree changes."
          onSelectPath={onSelectPath}
        />
      </div>
      <ResizeHandle
        axis="y"
        className="commit-info-splitter"
        label="Resize commit details"
        onResize={onResizeDetails}
      />
      <CommitDetails
        branchName={branchName}
        commit={commit}
        fileCount={files.length}
      />
    </aside>
  );
}

function CommitDetails({
  commit,
  branchName,
  fileCount,
}: {
  commit: CommitInfo | null;
  branchName?: string;
  fileCount: number;
}) {
  return (
    <section className="commit-details-section">
      {commit ? (
        <div className="commit-detail-body">
          <div className="commit-detail-heading">
            <span className="commit-detail-subject">{commit.subject}</span>
            <span className="commit-detail-hash mono-value">{commit.shortHash}</span>
          </div>
          <div className="commit-detail-meta">
            <span>{commit.author}</span>
            <span>{formatDate(commit.date)}</span>
          </div>
          <div className="commit-detail-line">
            <GitBranch size={13} />
            <span>
              In 1 branch: <strong>{branchName ?? "current"}</strong>
            </span>
          </div>
          <div className="commit-detail-line muted">
            <span>{fileCount} changed {fileCount === 1 ? "file" : "files"}</span>
          </div>
        </div>
      ) : (
        <div className="commit-detail-body">
          <div className="commit-detail-heading">
            <span className="commit-detail-subject">Working tree changes</span>
            <span className="commit-detail-hash">live</span>
          </div>
          <div className="commit-detail-line">
            <GitBranch size={13} />
            <span>
              On branch: <strong>{branchName ?? "current"}</strong>
            </span>
          </div>
          <div className="commit-detail-line muted">
            <span>{fileCount} changed {fileCount === 1 ? "file" : "files"}</span>
          </div>
        </div>
      )}
    </section>
  );
}

function ProjectSwitcherPopover({
  activeProjectId,
  projects,
  onChooseRepository,
  onClose,
  onRemoveProject,
  onSelectProject,
}: {
  activeProjectId: string | null;
  projects: SavedProject[];
  onChooseRepository(): void;
  onClose(): void;
  onRemoveProject(projectId: string): void;
  onSelectProject(project: SavedProject): void;
}) {
  return (
    <div className="project-switcher-popover" role="dialog" aria-label="Switch project">
      <div className="project-switcher-head">
        <div>
          <div className="project-switcher-title">Projects</div>
          <div className="project-switcher-count">{projects.length} saved</div>
        </div>
        <button className="icon-button" aria-label="Close projects" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <button className="primary-action rail-action" onClick={onChooseRepository}>
        <Plus size={16} />
        Open repository
      </button>
      <div className="project-list project-switcher-list">
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
            onSelect={() => onSelectProject(project)}
            onRemove={() => onRemoveProject(project.id)}
          />
        ))}
      </div>
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

function VirtualCommitList({
  commits,
  activeCommit,
  filter,
  loading,
  onChangeFilter,
  onSelectCommit,
  onSelectWorkingTree,
}: {
  commits: CommitInfo[];
  activeCommit: string | null;
  filter: string;
  loading: boolean;
  onChangeFilter(filter: string): void;
  onSelectCommit(hash: string): void;
  onSelectWorkingTree(): void;
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
        <CommitListHeader
          activeCommit={activeCommit}
          filter={filter}
          onChangeFilter={onChangeFilter}
          onSelectWorkingTree={onSelectWorkingTree}
        />
        <div className="commit-list">
          <LoadingRows />
        </div>
      </div>
    );
  }

  if (graphRows.length === 0) {
    return (
      <div className="commit-table" style={tableStyle}>
        <CommitListHeader
          activeCommit={activeCommit}
          filter={filter}
          onChangeFilter={onChangeFilter}
          onSelectWorkingTree={onSelectWorkingTree}
        />
        <div className="commit-list empty-list">
          <div className="empty-inline">No commits match the current filter.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="commit-table" style={tableStyle}>
      <CommitListHeader
        activeCommit={activeCommit}
        filter={filter}
        onChangeFilter={onChangeFilter}
        onSelectWorkingTree={onSelectWorkingTree}
      />
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

function CommitListHeader({
  activeCommit,
  filter,
  onChangeFilter,
  onSelectWorkingTree,
}: {
  activeCommit: string | null;
  filter: string;
  onChangeFilter(filter: string): void;
  onSelectWorkingTree(): void;
}) {
  return (
    <div className="commit-list-header">
      <span className="commit-list-worktree-cell">
        <button
          className={activeCommit ? "commit-worktree-button" : "commit-worktree-button active"}
          title="Show working tree"
          aria-label="Show working tree"
          onClick={onSelectWorkingTree}
        >
          <CheckCircle2 size={13} />
        </button>
      </span>
      <label className="commit-header-search">
        <Search size={13} />
        <input
          value={filter}
          onChange={(event) => onChangeFilter(event.target.value)}
          placeholder="Search commits"
        />
      </label>
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

function loadWorkbenchLayout(): WorkbenchLayout {
  if (typeof localStorage === "undefined") {
    return defaultWorkbenchLayout;
  }

  try {
    const raw = localStorage.getItem(layoutStorageKey);
    if (!raw) {
      return defaultWorkbenchLayout;
    }

    return normalizeWorkbenchLayout(JSON.parse(raw));
  } catch {
    return defaultWorkbenchLayout;
  }
}

function saveWorkbenchLayout(layout: WorkbenchLayout): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(layoutStorageKey, JSON.stringify(layout));
}

function normalizeWorkbenchLayout(value: unknown): WorkbenchLayout {
  const record = isRecord(value) ? value : {};
  const projectInToolDock =
    typeof record.projectInToolDock === "boolean"
      ? record.projectInToolDock
      : defaultWorkbenchLayout.projectInToolDock;
  const detachedGitPanels = normalizeDetachedGitPanels(record.detachedGitPanels);
  const activityView = normalizeActivityView(
    record.activityView,
    projectInToolDock,
    detachedGitPanels,
  );

  return {
    activityView,
    toolDock: isToolDock(record.toolDock)
      ? record.toolDock
      : defaultWorkbenchLayout.toolDock,
    treeDock: isTreeDock(record.treeDock)
      ? record.treeDock
      : defaultWorkbenchLayout.treeDock,
    projectInToolDock,
    gitPanelOrder: normalizeGitPanelOrder(record.gitPanelOrder),
    detachedGitPanels,
    panelSizes: normalizePanelSizes(record.panelSizes),
  };
}

function normalizeActivityView(
  value: unknown,
  projectInToolDock: boolean,
  detachedGitPanels: GitPanelId[],
): ToolPanelId {
  if (!isToolPanelId(value)) {
    return defaultWorkbenchLayout.activityView;
  }
  if (value === "project" && !projectInToolDock) {
    return "git";
  }
  if (isGitPanelId(value) && !detachedGitPanels.includes(value)) {
    return "git";
  }

  return value;
}

function normalizeGitPanelOrder(value: unknown): GitPanelId[] {
  if (!Array.isArray(value)) {
    return defaultGitPanelOrder;
  }

  const seen = new Set<GitPanelId>();
  const order = value.filter((item): item is GitPanelId => {
    if (!isGitPanelId(item) || seen.has(item)) {
      return false;
    }
    seen.add(item);
    return true;
  });

  return [
    ...order,
    ...defaultGitPanelOrder.filter((panel) => !seen.has(panel)),
  ];
}

function normalizeDetachedGitPanels(value: unknown): GitPanelId[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<GitPanelId>();
  return value.filter((item): item is GitPanelId => {
    if (!isGitPanelId(item) || seen.has(item)) {
      return false;
    }
    seen.add(item);
    return true;
  });
}

function normalizePanelSizes(value: unknown): PanelSizes {
  const record = isRecord(value) ? value : {};
  return {
    rail: normalizePanelSize(record.rail, defaultPanelSizes.rail, 220, 460),
    tree: normalizePanelSize(record.tree, defaultPanelSizes.tree, 220, 560),
    log: normalizePanelSize(record.log, defaultPanelSizes.log, 180, 560),
    branch: normalizePanelSize(record.branch, defaultPanelSizes.branch, 120, 460),
    details: normalizePanelSize(
      record.details,
      defaultPanelSizes.details,
      120,
      460,
    ),
    commitInfo: normalizePanelSize(
      record.commitInfo,
      defaultPanelSizes.commitInfo,
      110,
      360,
    ),
    sideDock: normalizePanelSize(
      record.sideDock,
      defaultPanelSizes.sideDock,
      320,
      620,
    ),
  };
}

function normalizePanelSize(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, min, max)
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isToolDock(value: unknown): value is ToolDock {
  return value === "left" || value === "bottom" || value === "right";
}

function isTreeDock(value: unknown): value is TreeDock {
  return value === "left" || value === "right";
}

function isToolPanelId(value: unknown): value is ToolPanelId {
  return (
    value === "project" ||
    value === "git" ||
    value === "terminal" ||
    isGitPanelId(typeof value === "string" ? value : null)
  );
}

function buildContentGridStyle(
  treeDock: TreeDock,
  toolDock: ToolDock,
  hasProjectSidePanel: boolean,
  treeWidth: number,
  logHeight: number,
  sideDockWidth: number,
): CSSProperties {
  if (!hasProjectSidePanel) {
    if (toolDock === "left") {
      return {
        gridTemplateColumns: `${sideDockWidth}px 6px minmax(0, 1fr)`,
        gridTemplateRows: "minmax(0, 1fr)",
        gridTemplateAreas: '"dock dock-splitter diff"',
      };
    }

    if (toolDock === "right") {
      return {
        gridTemplateColumns: `minmax(0, 1fr) 6px ${sideDockWidth}px`,
        gridTemplateRows: "minmax(0, 1fr)",
        gridTemplateAreas: '"diff dock-splitter dock"',
      };
    }

    return {
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateRows: `minmax(0, 1fr) 6px ${logHeight}px`,
      gridTemplateAreas: '"diff" "log-splitter" "log"',
    };
  }

  if (toolDock === "left") {
    return treeDock === "left"
      ? {
          gridTemplateColumns: `${sideDockWidth}px 6px ${treeWidth}px 6px minmax(0, 1fr)`,
          gridTemplateRows: "minmax(0, 1fr)",
          gridTemplateAreas:
            '"dock dock-splitter tree tree-splitter diff"',
        }
      : {
          gridTemplateColumns: `${sideDockWidth}px 6px minmax(0, 1fr) 6px ${treeWidth}px`,
          gridTemplateRows: "minmax(0, 1fr)",
          gridTemplateAreas:
            '"dock dock-splitter diff tree-splitter tree"',
        };
  }

  if (toolDock === "right") {
    return treeDock === "left"
      ? {
          gridTemplateColumns: `${treeWidth}px 6px minmax(0, 1fr) 6px ${sideDockWidth}px`,
          gridTemplateRows: "minmax(0, 1fr)",
          gridTemplateAreas:
            '"tree tree-splitter diff dock-splitter dock"',
        }
      : {
          gridTemplateColumns: `minmax(0, 1fr) 6px ${treeWidth}px 6px ${sideDockWidth}px`,
          gridTemplateRows: "minmax(0, 1fr)",
          gridTemplateAreas:
            '"diff tree-splitter tree dock-splitter dock"',
        };
  }

  return treeDock === "left"
    ? {
        gridTemplateColumns: `${treeWidth}px 6px minmax(0, 1fr)`,
        gridTemplateRows: `minmax(0, 1fr) 6px ${logHeight}px`,
        gridTemplateAreas:
          '"tree tree-splitter diff" "log-splitter log-splitter log-splitter" "log log log"',
      }
    : {
        gridTemplateColumns: `minmax(0, 1fr) 6px ${treeWidth}px`,
        gridTemplateRows: `minmax(0, 1fr) 6px ${logHeight}px`,
        gridTemplateAreas:
          '"diff tree-splitter tree" "log-splitter log-splitter log-splitter" "log log log"',
    };
}

function buildGitPanelGridStyle(
  dock: ToolDock,
  order: GitPanelId[],
  firstSize: number,
  lastSize: number,
): CSSProperties {
  if (order.length === 0) {
    return {
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateRows: "minmax(0, 1fr)",
      gridTemplateAreas: '"empty"',
    };
  }

  if (order.length === 1) {
    return {
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateRows: "minmax(0, 1fr)",
      gridTemplateAreas: `"${order[0]}"`,
    };
  }

  if (order.length === 2) {
    const [first, second] = order;
    if (dock !== "bottom") {
      return {
        gridTemplateColumns: "minmax(0, 1fr)",
        gridTemplateRows: `${firstSize}px 6px minmax(0, 1fr)`,
        gridTemplateAreas: `"${first}" "git-splitter-1" "${second}"`,
      };
    }

    return {
      gridTemplateColumns: `${firstSize}px 6px minmax(0, 1fr)`,
      gridTemplateAreas: `"${first} git-splitter-1 ${second}"`,
    };
  }

  const [first, second, third] = order;
  if (dock !== "bottom") {
    return {
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateRows: `${firstSize}px 6px minmax(0, 1fr) 6px ${lastSize}px`,
      gridTemplateAreas: `"${first}" "git-splitter-1" "${second}" "git-splitter-2" "${third}"`,
    };
  }

  return {
    gridTemplateColumns: `${firstSize}px 6px minmax(0, 1fr) 6px ${lastSize}px`,
    gridTemplateAreas: `"${first} git-splitter-1 ${second} git-splitter-2 ${third}"`,
  };
}

function gitPanelLabel(panelId: GitPanelId): string {
  switch (panelId) {
    case "branches":
      return "Branches";
    case "history":
      return "History";
    case "details":
      return "Details";
  }
}

function isGitPanelId(panelId: string | null | undefined): panelId is GitPanelId {
  return panelId === "branches" || panelId === "history" || panelId === "details";
}

function previewTabId(mode: PreviewMode, path: string, commit: string | null): string {
  return `${mode}:${commit ?? "worktree"}:${path}`;
}

function fileNameFromPath(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function parentPathFromPath(path: string): string {
  return path.split("/").filter(Boolean).slice(0, -1).join("/");
}

function fileExtension(path: string): string {
  const fileName = fileNameFromPath(path);
  const extension = fileName.includes(".") ? fileName.split(".").pop() : null;
  return extension ? extension.slice(0, 4).toLowerCase() : "";
}

function editorDraftKey(projectPath: string, filePath: string): string {
  return `${projectPath}\u0000${filePath}`;
}

function isDraftDirty(draft: EditorDraft | null | undefined): boolean {
  return Boolean(draft && (draft.conflict || draft.content !== draft.baseContent));
}

function countDirtyDrafts(drafts: Record<string, EditorDraft>): number {
  return Object.values(drafts).filter(isDraftDirty).length;
}

function countDirtyDraftsForProject(
  drafts: Record<string, EditorDraft>,
  projectPath: string,
): number {
  const prefix = `${projectPath}\u0000`;
  return Object.entries(drafts).filter(
    ([key, draft]) => key.startsWith(prefix) && isDraftDirty(draft),
  ).length;
}

function omitDraft(
  drafts: Record<string, EditorDraft>,
  keyToRemove: string,
): Record<string, EditorDraft> {
  const { [keyToRemove]: _removed, ...remaining } = drafts;
  return remaining;
}

function omitDraftsForProject(
  drafts: Record<string, EditorDraft>,
  projectPath: string,
): Record<string, EditorDraft> {
  const prefix = `${projectPath}\u0000`;
  return Object.fromEntries(
    Object.entries(drafts).filter(([key]) => !key.startsWith(prefix)),
  );
}

function conflictToMarkerFile(conflict: SaveConflict): FileContents {
  return {
    name: conflict.path,
    contents:
      "<<<<<<< Disk\n" +
      ensureTrailingNewline(conflict.currentContent) +
      "=======\n" +
      ensureTrailingNewline(conflict.proposedContent) +
      ">>>>>>> Your changes\n",
  };
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
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
