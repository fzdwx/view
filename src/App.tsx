import {
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type UIEvent,
  useCallback,
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
  Code2,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Folder,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequestArrow,
  Image as ImageIcon,
  Keyboard,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  Save,
  Settings as SettingsIcon,
  Tag,
  TerminalSquare,
  Type,
  X,
} from "lucide-react";
import { DiffPanel } from "./components/DiffPanel";
import { TerminalPanel } from "./components/TerminalPanel";
import { TreePanel } from "./components/TreePanel";
import {
  type BranchInfo,
  type CommitInfo,
  type EditorTextMatch,
  type FileContent,
  type FileSearchResult,
  type PullMode,
  type RepositoryPayload,
  type SaveConflict,
  type TagInfo,
  createProjectFile,
  deleteProjectFile,
  fetchRemotes,
  getCommits,
  getFileContent,
  getFileDiff,
  getProjectFiles,
  isTauriRuntime,
  loadRepository,
  pullCurrentBranch,
  renameProjectFile,
  replaceEditorText,
  saveFileContent,
  searchEditorText,
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
type FileViewMode = "preview" | "source";
type ToolDock = "left" | "bottom" | "right";
type TreeDock = "left" | "right";
type ProjectDock = TreeDock | "panel";
type EditorDock = "left" | "right";
type GitPanelId = "branches" | "history" | "details";
type ToolPanelId = "project" | "git" | "terminal" | GitPanelId;

const defaultGitPanelOrder: GitPanelId[] = ["branches", "history", "details"];
const layoutStorageKey = "view.workbench-layout.v1";
const settingsStorageKey = "view.settings.v1";

type ShortcutAction =
  | "commandPanel"
  | "saveFile"
  | "pullCurrentBranch"
  | "openGitLog"
  | "openTerminal"
  | "switchProject";

interface AppSettings {
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  lineHeight: number;
  shortcuts: Record<ShortcutAction, string>;
}

const defaultAppSettings: AppSettings = {
  fontFamily:
    '"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  fontSize: 12,
  fontWeight: "400",
  lineHeight: 1.56,
  shortcuts: {
    commandPanel: "Mod+P",
    saveFile: "Mod+S",
    pullCurrentBranch: "Mod+T",
    openGitLog: "Mod+G",
    openTerminal: "Mod+`",
    switchProject: "Mod+O",
  },
};

const shortcutRows: Array<{
  action: ShortcutAction;
  label: string;
  description: string;
}> = [
  {
    action: "commandPanel",
    label: "Command panel",
    description: "Search files and commands",
  },
  {
    action: "saveFile",
    label: "Save file",
    description: "Save the active editor tab",
  },
  {
    action: "pullCurrentBranch",
    label: "Pull branch",
    description: "Choose merge or rebase",
  },
  {
    action: "openGitLog",
    label: "Open Git log",
    description: "Focus the Git panel",
  },
  {
    action: "openTerminal",
    label: "Open terminal",
    description: "Focus the terminal panel",
  },
  {
    action: "switchProject",
    label: "Switch project",
    description: "Open the project switcher",
  },
];

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

interface EditorGitMarker {
  id: string;
  line: number;
  lineCount: number;
  oldStart: number;
  oldLineCount: number;
  newStart: number;
  newLineCount: number;
  additions: number;
  deletions: number;
  kind: "added" | "modified" | "deleted";
  oldLines: string[];
  newLines: string[];
  diffLines: string[];
}

interface EditorFindState {
  readonly open: boolean;
  readonly replaceOpen: boolean;
  readonly query: string;
  readonly replaceText: string;
  readonly activeIndex: number;
}

interface EditorScrollMetrics {
  readonly top: number;
  readonly left: number;
  readonly height: number;
  readonly width: number;
}

type EditorSearchHighlightSegment =
  | {
      readonly kind: "plain";
      readonly text: string;
    }
  | {
      readonly active: boolean;
      readonly kind: "match";
      readonly text: string;
    };

export function App() {
  const queryClient = useQueryClient();
  const [initialLayout] = useState(loadWorkbenchLayout);
  const [projects, setProjects] = useState<SavedProject[]>(() =>
    loadSavedProjects(),
  );
  const [appSettings, setAppSettings] = useState(loadAppSettings);
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pullChoiceOpen, setPullChoiceOpen] = useState(false);
  const [pullPending, setPullPending] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  const [panelSizes, setPanelSizes] = useState<PanelSizes>(
    initialLayout.panelSizes,
  );
  const remoteFetchInFlightRef = useRef(false);
  const branchPullInFlightRef = useRef(false);
  const commandRestoreFocusRef = useRef<HTMLElement | null>(null);
  const previewRequestIdRef = useRef(0);

  useEffect(() => {
    saveProjects(projects);
  }, [projects]);

  useEffect(() => {
    saveAppSettings(appSettings);
  }, [appSettings]);

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

  const selectedProjectFile = useMemo(
    () =>
      (projectFilesQuery.data ?? repositoryQuery.data?.files ?? []).find(
        (file) => file.path === selectedProjectPath,
      ) ?? null,
    [projectFilesQuery.data, repositoryQuery.data?.files, selectedProjectPath],
  );

  const fileWorktreeDiffQuery = useQuery({
    queryKey: [
      "file-worktree-diff",
      activeProject?.activePath,
      selectedProjectPath,
      selectedProjectFile?.status,
    ],
    queryFn: async () => {
      const rootPath = activeProject!.activePath;
      const filePath = selectedProjectPath!;

      return {
        rootPath,
        filePath,
        diff: await getFileDiff(rootPath, filePath, null),
      };
    },
    enabled: Boolean(
      activeProject &&
        selectedProjectPath &&
        previewMode === "file" &&
        selectedProjectFile?.status &&
        isChangedFileStatus(selectedProjectFile.status),
    ),
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
  const currentWorktreeFileDiff =
    fileWorktreeDiffQuery.data?.rootPath === activeProject?.activePath &&
    fileWorktreeDiffQuery.data?.filePath === selectedProjectPath
      ? fileWorktreeDiffQuery.data.diff
      : "";
  const editorGitMarkers = useMemo(
    () => buildEditorGitMarkers(currentWorktreeFileDiff),
    [currentWorktreeFileDiff],
  );
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
    "--app-font-family": appSettings.fontFamily,
    "--mono": appSettings.fontFamily,
    "--editor-font-size": `${appSettings.fontSize}px`,
    "--editor-font-weight": appSettings.fontWeight,
    "--editor-line-height": String(appSettings.lineHeight),
  } as CSSProperties;
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
  const projectTreeTitle = useMemo(
    () =>
      activeProject ? (
        <ProjectTreeTitle path={activeProject.activePath} />
      ) : (
        "Project"
      ),
    [activeProject?.activePath],
  );
  const clearDockDragRef = useRef(clearDockDrag);
  const createFileFromTreeRef = useRef(createFileFromTree);
  const deleteFileFromTreeRef = useRef(deleteFileFromTree);
  const renameFileFromTreeRef = useRef(renameFileFromTree);
  clearDockDragRef.current = clearDockDrag;
  createFileFromTreeRef.current = createFileFromTree;
  deleteFileFromTreeRef.current = deleteFileFromTree;
  renameFileFromTreeRef.current = renameFileFromTree;
  const handleTreeDragEnd = useCallback(() => {
    clearDockDragRef.current();
  }, []);
  const handleTreeDragStart = useCallback(() => {
    setDraggingTreePanel(true);
  }, []);
  const handleProjectTreeCreateFile = useCallback((parentPath: string | null) => {
    void createFileFromTreeRef.current(parentPath);
  }, []);
  const handleProjectTreeDeleteFile = useCallback((path: string) => {
    void deleteFileFromTreeRef.current(path);
  }, []);
  const handleProjectTreeRenameFile = useCallback(
    (fromPath: string, toPath: string) => {
      void renameFileFromTreeRef.current(fromPath, toPath);
    },
    [],
  );
  const handleProjectTreeSelectPath = useCallback((path: string) => {
    const id = previewTabId("file", path, null);
    const nextTab: PreviewTab = { id, mode: "file", path, commit: null };

    setPreviewTabs((tabs) => {
      if (tabs.some((tab) => tab.id === id)) {
        return tabs;
      }
      return [...tabs, nextTab];
    });
    setActivePreviewTabId(id);
    setPreviewMode("file");
    setPreviewTarget(null);
    setSelectedProjectPath(path);
    setSelectedChangePath(null);
  }, []);

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

      if (matchesShortcut(event, appSettings.shortcuts.commandPanel)) {
        event.preventDefault();
        if (activeProject) {
          openCommandPanel();
        }
        return;
      }

      if (matchesShortcut(event, appSettings.shortcuts.saveFile)) {
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

      if (matchesShortcut(event, appSettings.shortcuts.pullCurrentBranch)) {
        event.preventDefault();
        if (!activeProject || !isTauriRuntime()) {
          return;
        }
        setPullError(null);
        setPullChoiceOpen(true);
        return;
      }

      if (matchesShortcut(event, appSettings.shortcuts.openGitLog)) {
        event.preventDefault();
        if (activeProject) {
          setActivityView("git");
          setToolPanelCollapsed(false);
        }
        return;
      }

      if (matchesShortcut(event, appSettings.shortcuts.openTerminal)) {
        event.preventDefault();
        if (activeProject) {
          setActivityView("terminal");
          setToolPanelCollapsed(false);
        }
        return;
      }

      if (matchesShortcut(event, appSettings.shortcuts.switchProject)) {
        event.preventDefault();
        setProjectSwitcherOpen((open) => !open);
        setSettingsOpen(false);
        return;
      }

      if (event.key === "Escape" && pullChoiceOpen) {
        event.preventDefault();
        setPullChoiceOpen(false);
        return;
      }

      if (event.key === "Escape" && commandOpen && !editableTarget) {
        event.preventDefault();
        closeCommandPanel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeEditorDraft,
    activeProject,
    appSettings.shortcuts,
    commandOpen,
    commitsQuery.refetch,
    fileWorktreeDiffQuery.refetch,
    pullChoiceOpen,
    previewMode,
    projectFilesQuery.refetch,
    repositoryQuery.refetch,
  ]);

  useEffect(() => {
    if (dirtyDraftCount === 0) {
      return;
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
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
    commandRestoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
    const element = commandRestoreFocusRef.current;
    commandRestoreFocusRef.current = null;
    window.requestAnimationFrame(() => {
      if (!element || !document.contains(element)) {
        return;
      }
      element.focus({ preventScroll: true });
    });
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

  async function refreshProjectFileState(projectPath: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["project-files", projectPath] }),
      queryClient.invalidateQueries({ queryKey: ["repository", projectPath] }),
      queryClient.invalidateQueries({ queryKey: ["file-content", projectPath] }),
      queryClient.invalidateQueries({ queryKey: ["file-worktree-diff", projectPath] }),
      queryClient.invalidateQueries({ queryKey: ["file-diff", projectPath] }),
    ]);
  }

  async function createFileFromTree(parentPath: string | null) {
    if (!activeProject) {
      return;
    }

    const input = window.prompt(
      parentPath ? `New file path in ${parentPath}` : "New file path",
      "untitled.txt",
    );
    if (input === null) {
      return;
    }

    const requestedPath = buildRequestedFilePath(parentPath, input);
    if (!requestedPath) {
      return;
    }

    try {
      const createdPath = await createProjectFile(activeProject.activePath, requestedPath);
      await refreshProjectFileState(activeProject.activePath);
      openPreviewTab("file", createdPath);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }

  async function renameFileFromTree(fromPath: string, toPath: string) {
    if (!activeProject || fromPath === toPath) {
      return;
    }

    const draftKey = editorDraftKey(activeProject.activePath, fromPath);
    if (isDraftDirty(editorDrafts[draftKey])) {
      const confirmed = window.confirm(
        `Rename ${fromPath} and discard unsaved editor changes?`,
      );
      if (!confirmed) {
        return;
      }
      setEditorDrafts((current) => omitDraft(current, draftKey));
    }

    try {
      const renamedPath = await renameProjectFile(
        activeProject.activePath,
        fromPath,
        toPath,
      );
      movePreviewTabPath(fromPath, renamedPath);
      moveEditorDraftPath(activeProject.activePath, fromPath, renamedPath);
      if (selectedProjectPath === fromPath) {
        setSelectedProjectPath(renamedPath);
      }
      await refreshProjectFileState(activeProject.activePath);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
      await refreshProjectFileState(activeProject.activePath);
    }
  }

  async function deleteFileFromTree(path: string) {
    if (!activeProject) {
      return;
    }

    const confirmed = window.confirm(`Delete ${path}?`);
    if (!confirmed) {
      return;
    }

    const draftKey = editorDraftKey(activeProject.activePath, path);
    if (isDraftDirty(editorDrafts[draftKey])) {
      const discardConfirmed = window.confirm(
        `${path} has unsaved editor changes. Delete it and discard those changes?`,
      );
      if (!discardConfirmed) {
        return;
      }
    }

    try {
      await deleteProjectFile(activeProject.activePath, path);
      setEditorDrafts((current) => omitDraft(current, draftKey));
      removePreviewTabsForPath(path);
      await refreshProjectFileState(activeProject.activePath);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }

  function movePreviewTabPath(fromPath: string, toPath: string) {
    const fromTabId = previewTabId("file", fromPath, null);
    const toTabId = previewTabId("file", toPath, null);
    setPreviewTabs((tabs) =>
      tabs.map((tab) =>
        tab.mode === "file" && tab.path === fromPath
          ? { ...tab, id: toTabId, path: toPath }
          : tab,
      ),
    );
    if (activePreviewTabId === fromTabId) {
      setActivePreviewTabId(toTabId);
    }
  }

  function removePreviewTabsForPath(path: string) {
    const removedTabIds = new Set(
      previewTabs
        .filter((tab) => tab.mode === "file" && tab.path === path)
        .map((tab) => tab.id),
    );
    if (removedTabIds.size === 0) {
      return;
    }

    const removedIndex = previewTabs.findIndex((tab) => removedTabIds.has(tab.id));
    const nextTabs = previewTabs.filter((tab) => !removedTabIds.has(tab.id));
    setPreviewTabs(nextTabs);
    if (activePreviewTabId && removedTabIds.has(activePreviewTabId)) {
      const nextTab =
        nextTabs[Math.max(0, removedIndex - 1)] ?? nextTabs[0] ?? null;
      if (nextTab) {
        activatePreviewTab(nextTab);
        return;
      }

      setActivePreviewTabId(null);
      setSelectedProjectPath(null);
      setSelectedChangePath(null);
      setPreviewMode("file");
      setPreviewTarget(null);
      return;
    }

    if (selectedProjectPath === path) {
      setSelectedProjectPath(null);
    }
  }

  function moveEditorDraftPath(projectPath: string, fromPath: string, toPath: string) {
    const fromKey = editorDraftKey(projectPath, fromPath);
    const toKey = editorDraftKey(projectPath, toPath);
    setEditorDrafts((current) => {
      const draft = current[fromKey];
      if (!draft) {
        return current;
      }
      const { [fromKey]: _removed, ...remaining } = current;
      return {
        ...remaining,
        [toKey]: draft,
      };
    });
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

  async function performPull(mode: PullMode) {
    if (!activeProject || branchPullInFlightRef.current) {
      return;
    }

    branchPullInFlightRef.current = true;
    setPullPending(true);
    setPullError(null);
    try {
      await pullCurrentBranch(activeProject.activePath, mode);
      setPullChoiceOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPullError(message);
      console.warn("Failed to pull current branch", error);
    } finally {
      await Promise.all([
        repositoryQuery.refetch(),
        commitsQuery.refetch(),
        projectFilesQuery.refetch(),
        fileWorktreeDiffQuery.refetch(),
      ]);
      branchPullInFlightRef.current = false;
      setPullPending(false);
    }
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
          graphWidthCommits={commits}
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
          title={projectTreeTitle}
          emptyTitle="No project files"
          emptyCopy="Tracked and untracked files will appear here."
          onDragEnd={handleTreeDragEnd}
          onDragStart={handleTreeDragStart}
          onCreateFile={handleProjectTreeCreateFile}
          onDeleteFile={handleProjectTreeDeleteFile}
          onRenameFile={handleProjectTreeRenameFile}
          onSelectPath={handleProjectTreeSelectPath}
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
        <button
          className={
            settingsOpen
              ? "activity-button rail-project-button active"
              : "activity-button rail-project-button"
          }
          aria-label="Settings"
          title="Settings"
          onClick={() => {
            setSettingsOpen((open) => !open);
            setProjectSwitcherOpen(false);
          }}
        >
          <SettingsIcon size={18} />
        </button>
      </aside>

      {settingsOpen ? (
        <SettingsPage
          settings={appSettings}
          onChange={setAppSettings}
          onClose={() => setSettingsOpen(false)}
          onReset={() => setAppSettings(defaultAppSettings)}
        />
      ) : null}

      {pullChoiceOpen ? (
        <PullChoiceDialog
          error={pullError}
          pending={pullPending}
          projectName={activeProject?.name ?? "current project"}
          onCancel={() => setPullChoiceOpen(false)}
          onPull={(mode) => void performPull(mode)}
        />
      ) : null}

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
                  fileWorktreeDiffQuery.isFetching ||
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
                  editorSessionKey={activePreviewTabId}
                  error={
                    fileContentQuery.isError
                      ? String(fileContentQuery.error.message)
                      : null
                  }
                  file={currentFileContent}
                  editorFontSize={appSettings.fontSize}
                  editorLineHeightRatio={appSettings.lineHeight}
                  gitMarkers={editorGitMarkers}
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

function SettingsPage({
  settings,
  onChange,
  onClose,
  onReset,
}: {
  settings: AppSettings;
  onChange(settings: AppSettings): void;
  onClose(): void;
  onReset(): void;
}) {
  const updateShortcut = (action: ShortcutAction, shortcut: string) => {
    onChange({
      ...settings,
      shortcuts: {
        ...settings.shortcuts,
        [action]: shortcut,
      },
    });
  };

  return (
    <section className="settings-page" aria-label="Settings">
      <div className="settings-panel">
        <div className="settings-head">
          <div>
            <span>Settings</span>
            <small>Editor, terminal and shortcuts</small>
          </div>
          <button className="icon-button" aria-label="Close settings" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="settings-body">
          <section className="settings-section">
            <div className="settings-section-title">
              <Type size={14} />
              <span>Font</span>
            </div>
            <label className="settings-field wide">
              <span>Family</span>
              <input
                value={settings.fontFamily}
                spellCheck={false}
                onChange={(event) =>
                  onChange({ ...settings, fontFamily: event.target.value })
                }
              />
            </label>
            <div className="settings-grid">
              <label className="settings-field">
                <span>Size</span>
                <input
                  type="number"
                  min={10}
                  max={22}
                  value={settings.fontSize}
                  onChange={(event) =>
                    onChange({
                      ...settings,
                      fontSize: clamp(Number(event.target.value), 10, 22),
                    })
                  }
                />
              </label>
              <label className="settings-field">
                <span>Weight</span>
                <select
                  value={settings.fontWeight}
                  onChange={(event) =>
                    onChange({ ...settings, fontWeight: event.target.value })
                  }
                >
                  <option value="300">Light</option>
                  <option value="400">Regular</option>
                  <option value="500">Medium</option>
                  <option value="600">Semibold</option>
                </select>
              </label>
              <label className="settings-field">
                <span>Line height</span>
                <input
                  type="number"
                  min={1.2}
                  max={2}
                  step={0.05}
                  value={settings.lineHeight}
                  onChange={(event) =>
                    onChange({
                      ...settings,
                      lineHeight: clamp(Number(event.target.value), 1.2, 2),
                    })
                  }
                />
              </label>
            </div>
          </section>
          <section className="settings-section">
            <div className="settings-section-title">
              <Keyboard size={14} />
              <span>Shortcuts</span>
            </div>
            <div className="shortcut-list">
              {shortcutRows.map((row) => (
                <label key={row.action} className="shortcut-row">
                  <span>
                    {row.label}
                    <small>{row.description}</small>
                  </span>
                  <input
                    value={settings.shortcuts[row.action]}
                    spellCheck={false}
                    onChange={(event) => updateShortcut(row.action, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </section>
        </div>
        <div className="settings-footer">
          <button className="ghost-button settings-action" onClick={onReset}>
            Reset
          </button>
          <button className="primary-action settings-action" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </section>
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
  editorSessionKey,
  error,
  file,
  editorFontSize,
  editorLineHeightRatio,
  gitMarkers,
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
  editorSessionKey: string | null;
  error: string | null;
  file: FileContent | null;
  editorFontSize: number;
  editorLineHeightRatio: number;
  gitMarkers: EditorGitMarker[];
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
  const stageRef = useRef<HTMLDivElement | null>(null);
  const targetLineRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lineNumberTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const pendingEditorSelectionRef = useRef<{ start: number; end: number } | null>(
    null,
  );
  const editorSearchRequestRef = useRef(0);
  const editorSearchTimerRef = useRef<number | null>(null);
  const editorFindStatesRef = useRef(new Map<string, EditorFindState>());
  const currentEditorSessionKeyRef = useRef<string | null>(editorSessionKey);
  const currentEditorFindStateRef = useRef<EditorFindState>({
    open: false,
    replaceOpen: false,
    query: "",
    replaceText: "",
    activeIndex: 0,
  });
  const pendingEditorScrollMetricsRef = useRef<EditorScrollMetrics | null>(null);
  const editorScrollFrameRef = useRef<number | null>(null);
  const [editorFindOpen, setEditorFindOpen] = useState(false);
  const [editorReplaceOpen, setEditorReplaceOpen] = useState(false);
  const [editorFindQuery, setEditorFindQuery] = useState("");
  const [editorReplaceText, setEditorReplaceText] = useState("");
  const [editorMatches, setEditorMatches] = useState<EditorTextMatch[]>([]);
  const [editorSearchPending, setEditorSearchPending] = useState(false);
  const [activeEditorMatchIndex, setActiveEditorMatchIndex] = useState(0);
  const [activeGitMarkerId, setActiveGitMarkerId] = useState<string | null>(null);
  const [fileViewMode, setFileViewMode] = useState<FileViewMode>("source");
  const [editorScrollTop, setEditorScrollTop] = useState(0);
  const [editorScrollLeft, setEditorScrollLeft] = useState(0);
  const [editorViewportHeight, setEditorViewportHeight] = useState(0);
  const [editorViewportWidth, setEditorViewportWidth] = useState(0);
  const [editorLineHeight, setEditorLineHeight] = useState(
    editorFontSize * editorLineHeightRatio,
  );
  const [editorPaddingTop, setEditorPaddingTop] = useState(12);
  const [gitPopoverLeftOffset, setGitPopoverLeftOffset] = useState(0);
  const content = draft?.content ?? file?.content ?? "";
  const conflict = draft?.conflict ?? null;
  const mediaDataUrl = file?.mediaDataUrl ?? null;
  const mediaType = file?.mediaType ?? null;
  const renderableMedia = Boolean(mediaDataUrl && mediaType?.startsWith("image/"));
  const canShowMediaSource = Boolean(file && !file.binary && !file.tooLarge);
  const fallbackEditorLineHeight = editorFontSize * editorLineHeightRatio;
  currentEditorFindStateRef.current = {
    open: editorFindOpen,
    replaceOpen: editorReplaceOpen,
    query: editorFindQuery,
    replaceText: editorReplaceText,
    activeIndex: activeEditorMatchIndex,
  };
  const lines = useMemo(() => {
    if (!content) {
      return [];
    }

    return content.length > 0 ? content.split(/\r?\n/) : [""];
  }, [content]);
  const visibleGitMarkers = useMemo(
    () => filterVisibleEditorGitMarkers(gitMarkers, content),
    [content, gitMarkers],
  );
  const activeEditorMatch =
    editorMatches.length > 0
      ? editorMatches[Math.min(activeEditorMatchIndex, editorMatches.length - 1)]
      : null;
  const editorSearchHighlightSegments = useMemo(
    () =>
      editorFindOpen
        ? buildEditorSearchHighlightSegments(
            content,
            editorMatches,
            activeEditorMatchIndex,
          )
        : [],
    [activeEditorMatchIndex, content, editorFindOpen, editorMatches],
  );
  const activeGitMarker =
    visibleGitMarkers.find((marker) => marker.id === activeGitMarkerId) ?? null;
  const gitPopoverWidth = Math.min(430, Math.max(260, editorViewportWidth - 74));
  const gitPopoverLeft = clamp(
    44 + gitPopoverLeftOffset,
    12,
    Math.max(12, editorViewportWidth - gitPopoverWidth - 12),
  );
  const editorLineNumberText = useMemo(
    () =>
      Array.from({ length: Math.max(1, lines.length) }, (_, index) =>
        String(index + 1),
      ).join("\n"),
    [lines.length],
  );
  useLayoutEffect(() => {
    const previousKey = currentEditorSessionKeyRef.current;
    if (previousKey === editorSessionKey) {
      return;
    }

    if (previousKey) {
      editorFindStatesRef.current.set(previousKey, currentEditorFindStateRef.current);
    }

    const nextState = editorSessionKey
      ? editorFindStatesRef.current.get(editorSessionKey)
      : undefined;
    currentEditorSessionKeyRef.current = editorSessionKey;
    setEditorFindOpen(nextState?.open ?? false);
    setEditorReplaceOpen(nextState?.replaceOpen ?? false);
    setEditorFindQuery(nextState?.query ?? "");
    setEditorReplaceText(nextState?.replaceText ?? "");
    setActiveEditorMatchIndex(nextState?.activeIndex ?? 0);
    setEditorMatches([]);
    setEditorSearchPending(false);
  }, [editorSessionKey]);

  useEffect(() => {
    return () => {
      if (editorScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(editorScrollFrameRef.current);
        editorScrollFrameRef.current = null;
      }
    };
  }, []);

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

    textareaRef.current.scrollTop = Math.max(
      0,
      (target.line - 1) * editorLineHeight - 120,
    );
    syncEditorScrollMetrics(textareaRef.current, true);
  }, [target]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || textarea.value === content) {
      return;
    }

    textarea.value = content;
    syncEditorScrollMetrics(textarea, true);
  }, [content, file?.path]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const updateViewportHeight = () => {
      const style = window.getComputedStyle(textarea);
      setEditorViewportHeight(textarea.clientHeight);
      setEditorViewportWidth(textarea.clientWidth);
      setEditorLineHeight(measureEditorLineHeight(style, fallbackEditorLineHeight));
      setEditorPaddingTop(parseCssPixels(style.paddingTop, 12));
      syncEditorScrollMetrics(textarea, true);
    };
    updateViewportHeight();
    const observer = new ResizeObserver(updateViewportHeight);
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [editorFontSize, fallbackEditorLineHeight, file?.path]);

  useEffect(() => {
    if (!editorFindOpen) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const input = editorReplaceOpen
        ? replaceInputRef.current
        : findInputRef.current;
      input?.focus({ preventScroll: true });
      input?.select();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [editorFindOpen, editorReplaceOpen]);

  useEffect(() => {
    const requestId = editorSearchRequestRef.current + 1;
    editorSearchRequestRef.current = requestId;
    const query = editorFindQuery.trim();
    if (editorSearchTimerRef.current !== null) {
      window.clearTimeout(editorSearchTimerRef.current);
      editorSearchTimerRef.current = null;
    }

    if (!editorFindOpen || !query) {
      setEditorMatches([]);
      setEditorSearchPending(false);
      setActiveEditorMatchIndex(0);
      return;
    }

    setEditorSearchPending(true);
    editorSearchTimerRef.current = window.setTimeout(() => {
      editorSearchTimerRef.current = null;
      searchEditorText(content, query)
        .then((response) => {
          if (editorSearchRequestRef.current !== requestId) {
            return;
          }
          setEditorMatches(response.matches);
          setActiveEditorMatchIndex(0);
          if (response.matches[0]) {
            window.requestAnimationFrame(() => {
              if (editorSearchRequestRef.current === requestId) {
                revealEditorMatch(response.matches[0], false);
              }
            });
          }
        })
        .catch(() => {
          if (editorSearchRequestRef.current !== requestId) {
            return;
          }
          setEditorMatches([]);
          setActiveEditorMatchIndex(0);
        })
        .finally(() => {
          if (editorSearchRequestRef.current === requestId) {
            setEditorSearchPending(false);
          }
        });
    }, 220);

    return () => {
      if (editorSearchTimerRef.current !== null) {
        window.clearTimeout(editorSearchTimerRef.current);
        editorSearchTimerRef.current = null;
      }
    };
  }, [content, editorFindOpen, editorFindQuery, editorReplaceOpen]);

  useEffect(() => {
    if (activeEditorMatchIndex < editorMatches.length) {
      return;
    }

    setActiveEditorMatchIndex(Math.max(0, editorMatches.length - 1));
  }, [activeEditorMatchIndex, editorMatches.length]);

  useEffect(() => {
    setActiveGitMarkerId(null);
    setGitPopoverLeftOffset(0);
  }, [file?.path]);

  useEffect(() => {
    if (!renderableMedia) {
      setFileViewMode("source");
      return;
    }

    setFileViewMode("preview");
  }, [file?.path, renderableMedia]);

  useEffect(() => {
    if (fileViewMode === "source" && !canShowMediaSource) {
      setFileViewMode("preview");
    }
  }, [canShowMediaSource, fileViewMode]);

  useEffect(() => {
    if (!activeGitMarkerId) {
      return;
    }
    if (!visibleGitMarkers.some((marker) => marker.id === activeGitMarkerId)) {
      setActiveGitMarkerId(null);
    }
  }, [activeGitMarkerId, visibleGitMarkers]);

  useLayoutEffect(() => {
    const pendingSelection = pendingEditorSelectionRef.current;
    if (!pendingSelection || !textareaRef.current) {
      return;
    }

    pendingEditorSelectionRef.current = null;
    textareaRef.current.focus({ preventScroll: true });
    textareaRef.current.setSelectionRange(
      pendingSelection.start,
      pendingSelection.end,
    );
  }, [content]);

  function openEditorFind(replace: boolean) {
    setEditorFindOpen(true);
    setEditorReplaceOpen(replace);
    const selection = getTextareaSelection(textareaRef.current);
    if (selection && selection.start !== selection.end) {
      setEditorFindQuery(content.slice(selection.start, selection.end));
      setActiveEditorMatchIndex(0);
    }
  }

  function closeEditorFind() {
    setEditorFindOpen(false);
    setEditorReplaceOpen(false);
    textareaRef.current?.focus({ preventScroll: true });
  }

  function applyEditorScrollVars(metrics: EditorScrollMetrics) {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    stage.style.setProperty("--editor-scroll-top", `${metrics.top}px`);
    stage.style.setProperty("--editor-scroll-left", `${metrics.left}px`);
    if (lineNumberTextareaRef.current) {
      lineNumberTextareaRef.current.scrollTop = metrics.top;
    }
  }

  function commitEditorScrollMetrics(metrics: EditorScrollMetrics) {
    setEditorScrollTop(metrics.top);
    setEditorScrollLeft(metrics.left);
    setEditorViewportHeight(metrics.height);
    setEditorViewportWidth(metrics.width);
  }

  function syncEditorScrollMetrics(
    textarea: HTMLTextAreaElement,
    immediate: boolean,
  ) {
    const metrics: EditorScrollMetrics = {
      top: textarea.scrollTop,
      left: textarea.scrollLeft,
      height: textarea.clientHeight,
      width: textarea.clientWidth,
    };
    applyEditorScrollVars(metrics);

    if (immediate) {
      if (editorScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(editorScrollFrameRef.current);
        editorScrollFrameRef.current = null;
      }
      pendingEditorScrollMetricsRef.current = null;
      commitEditorScrollMetrics(metrics);
      return;
    }

    pendingEditorScrollMetricsRef.current = metrics;
    if (editorScrollFrameRef.current !== null) {
      return;
    }

    editorScrollFrameRef.current = window.requestAnimationFrame(() => {
      editorScrollFrameRef.current = null;
      const pendingMetrics = pendingEditorScrollMetricsRef.current;
      pendingEditorScrollMetricsRef.current = null;
      if (pendingMetrics) {
        commitEditorScrollMetrics(pendingMetrics);
      }
    });
  }

  function selectEditorMatch(index: number, focusEditor = false) {
    if (editorMatches.length === 0 || !textareaRef.current) {
      return;
    }

    const nextIndex = wrapIndex(index, editorMatches.length);
    const match = editorMatches[nextIndex];
    setActiveEditorMatchIndex(nextIndex);
    revealEditorMatch(match, focusEditor);
  }

  function revealEditorMatch(match: EditorTextMatch, focusEditor: boolean) {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const lineTop = editorPaddingTop + (match.lineNumber - 1) * editorLineHeight;
    const visibleTop = textarea.scrollTop;
    const visibleBottom = visibleTop + textarea.clientHeight;
    const margin = editorLineHeight * 4;

    if (lineTop < visibleTop + margin || lineTop > visibleBottom - margin) {
      textarea.scrollTop = Math.max(
        0,
        lineTop - textarea.clientHeight / 2 + editorLineHeight,
      );
    }
    if (focusEditor) {
      textarea.focus({ preventScroll: true });
    }
    textarea.setSelectionRange(match.start, match.end);
    syncEditorScrollMetrics(textarea, true);
  }

  async function replaceCurrentEditorMatch() {
    const textarea = textareaRef.current;
    if (!textarea || !activeEditorMatch) {
      return;
    }

    const sourceContent = content;
    const response = await replaceEditorText(
      sourceContent,
      editorFindQuery,
      editorReplaceText,
      activeEditorMatchIndex,
      false,
    );
    if (textarea.value !== sourceContent) {
      return;
    }
    textarea.focus({ preventScroll: true });
    textarea.setRangeText(
      editorReplaceText,
      activeEditorMatch.start,
      activeEditorMatch.end,
      "select",
    );
    pendingEditorSelectionRef.current = {
      start: response.selectionStart,
      end: response.selectionEnd,
    };
    onChangeDraft(textarea.value);
    setEditorMatches(response.matches);
    setActiveEditorMatchIndex(nextMatchIndexAfter(response.matches, response.selectionEnd));
  }

  async function replaceAllEditorMatches() {
    if (editorMatches.length === 0) {
      return;
    }

    const sourceContent = content;
    const response = await replaceEditorText(
      sourceContent,
      editorFindQuery,
      editorReplaceText,
      activeEditorMatchIndex,
      true,
    );
    const textarea = textareaRef.current;
    if (textarea) {
      if (textarea.value !== sourceContent) {
        return;
      }
      textarea.focus({ preventScroll: true });
      textarea.setRangeText(response.content, 0, textarea.value.length, "start");
      onChangeDraft(textarea.value);
    } else {
      onChangeDraft(response.content);
    }
    pendingEditorSelectionRef.current = {
      start: response.selectionStart,
      end: response.selectionEnd,
    };
    setEditorMatches(response.matches);
    setActiveEditorMatchIndex(0);
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === "f") {
      event.preventDefault();
      openEditorFind(false);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && key === "r") {
      event.preventDefault();
      openEditorFind(true);
    }
  }

  function handleEditorScroll(event: UIEvent<HTMLTextAreaElement>) {
    syncEditorScrollMetrics(event.currentTarget, false);
  }

  function revealGitMarker(marker: EditorGitMarker) {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const lineTop = editorPaddingTop + (marker.line - 1) * editorLineHeight;
    const visibleTop = textarea.scrollTop;
    const visibleBottom = visibleTop + textarea.clientHeight;
    const margin = editorLineHeight * 3;

    if (lineTop < visibleTop + margin || lineTop > visibleBottom - margin) {
      textarea.scrollTop = Math.max(
        0,
        lineTop - textarea.clientHeight / 2 + editorLineHeight,
      );
    }
    syncEditorScrollMetrics(textarea, true);
  }

  function toggleGitMarker(marker: EditorGitMarker) {
    setActiveGitMarkerId((current) => {
      const next = current === marker.id ? null : marker.id;
      if (next !== current) {
        setGitPopoverLeftOffset(0);
      }
      return next;
    });
    revealGitMarker(marker);
  }

  function revertGitMarker(marker: EditorGitMarker) {
    const nextContent = revertEditorGitMarker(content, marker);
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.focus({ preventScroll: true });
      textarea.value = nextContent;
      const selectionLine = Math.max(1, marker.newStart);
      const selectionStart = utf16OffsetForLine(nextContent, selectionLine);
      textarea.setSelectionRange(selectionStart, selectionStart);
      textarea.scrollTop = editorScrollTop;
      syncEditorScrollMetrics(textarea, true);
    }
    onChangeDraft(nextContent);
    setActiveGitMarkerId(null);
  }

  function handleEditorFindKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const key = event.key.toLowerCase();
    if (key === "escape") {
      event.preventDefault();
      closeEditorFind();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && key === "r") {
      event.preventDefault();
      setEditorReplaceOpen(true);
      window.requestAnimationFrame(() => replaceInputRef.current?.focus());
      return;
    }
    if (key === "enter") {
      event.preventDefault();
      if (event.shiftKey) {
        selectEditorMatch(activeEditorMatchIndex - 1);
      } else {
        selectEditorMatch(activeEditorMatchIndex + 1);
      }
    }
  }

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

  if (file.tooLarge) {
    return (
      <div className="empty-state">
        <div className="empty-title">File is too large</div>
        <div className="empty-copy">
          Files larger than the preview limit are not opened here.
        </div>
      </div>
    );
  }

  if (file.binary && !renderableMedia) {
    return (
      <div className="empty-state">
        <div className="empty-title">Binary file</div>
        <div className="empty-copy">{file.path} cannot be rendered as text.</div>
      </div>
    );
  }

  if (renderableMedia && fileViewMode === "preview") {
    return (
      <section className="media-preview-shell" aria-label={file.path}>
        <MediaViewToolbar
          canShowSource={canShowMediaSource}
          mediaType={mediaType}
          mode={fileViewMode}
          path={file.path}
          onChangeMode={setFileViewMode}
        />
        <div className="media-preview-stage">
          <img className="media-preview-image" src={mediaDataUrl ?? ""} alt={file.path} />
        </div>
      </section>
    );
  }

  const gitConflict = !conflict && hasGitConflictMarkers(content);
  if (gitConflict) {
    return (
      <section className="merge-page" aria-label={`Resolve ${file.path}`}>
        <div className="editor-toolbar conflict-toolbar">
          <div className="editor-status conflict">
            <AlertTriangle size={14} />
            <span>Merge conflict</span>
            <small>{file.path}</small>
          </div>
          <div className="editor-actions">
            <button className="primary-action editor-save" disabled={saving} onClick={onSave}>
              {saving ? <Loader2 className="spin" size={14} /> : <Save size={14} />}
              Save resolved
            </button>
          </div>
        </div>
        <div className="merge-diff-frame">
          <UnresolvedFile
            file={gitConflictToMarkerFile(file.path, content)}
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
          defaultValue={content}
          onKeyDown={handleEditorKeyDown}
          onScroll={handleEditorScroll}
          onChange={(event) => onChangeDraft(event.target.value)}
        />
        {saveError ? <div className="editor-error">{saveError}</div> : null}
      </section>
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
          defaultValue={content}
          onKeyDown={handleEditorKeyDown}
          onScroll={handleEditorScroll}
          onChange={(event) => onChangeDraft(event.target.value)}
        />
        {saveError ? <div className="editor-error">{saveError}</div> : null}
      </section>
    );
  }

  const editorShellClassName = [
    "file-editor-shell",
    editorFindOpen ? "find-open" : "",
    renderableMedia ? "media-source-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      className={editorShellClassName}
      aria-label={file.path}
    >
      {renderableMedia ? (
        <MediaViewToolbar
          canShowSource={canShowMediaSource}
          mediaType={mediaType}
          mode={fileViewMode}
          path={file.path}
          onChangeMode={setFileViewMode}
        />
      ) : null}
      {editorFindOpen ? (
        <div className="editor-findbar" onKeyDown={handleEditorFindKeyDown}>
          <Search size={14} />
          <input
            ref={findInputRef}
            aria-label="Find in file"
            placeholder="Find"
            value={editorFindQuery}
            onChange={(event) => {
              setEditorFindQuery(event.target.value);
              setActiveEditorMatchIndex(0);
            }}
          />
          <span className="editor-find-count">
            {editorSearchPending
              ? "..."
              : editorFindQuery
                ? `${editorMatches.length === 0 ? 0 : activeEditorMatchIndex + 1}/${editorMatches.length}`
                : "0/0"}
          </span>
          <button
            type="button"
            className="ghost-button editor-find-action"
            disabled={editorMatches.length === 0}
            onClick={() => selectEditorMatch(activeEditorMatchIndex - 1)}
          >
            Prev
          </button>
          <button
            type="button"
            className="ghost-button editor-find-action"
            disabled={editorMatches.length === 0}
            onClick={() => selectEditorMatch(activeEditorMatchIndex + 1)}
          >
            Next
          </button>
          {editorReplaceOpen ? (
            <>
              <input
                ref={replaceInputRef}
                aria-label="Replace in file"
                placeholder="Replace"
                value={editorReplaceText}
                onChange={(event) => setEditorReplaceText(event.target.value)}
              />
              <button
                type="button"
                className="ghost-button editor-find-action"
                disabled={!activeEditorMatch}
                onClick={replaceCurrentEditorMatch}
              >
                Replace
              </button>
              <button
                type="button"
                className="ghost-button editor-find-action"
                disabled={editorMatches.length === 0}
                onClick={replaceAllEditorMatches}
              >
                All
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="icon-button editor-find-close"
            aria-label="Close find"
            onClick={closeEditorFind}
          >
            <X size={13} />
          </button>
        </div>
      ) : null}
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
      <div
        ref={stageRef}
        className="file-editor-stage"
        style={
          {
            "--editor-scroll-top": `${editorScrollTop}px`,
            "--editor-scroll-left": `${editorScrollLeft}px`,
            "--editor-line-height": `${editorLineHeight}px`,
            "--editor-padding-top": `${editorPaddingTop}px`,
          } as CSSProperties
        }
      >
        <textarea
          ref={lineNumberTextareaRef}
          className="editor-line-number-gutter"
          value={editorLineNumberText}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          spellCheck={false}
        />
        {editorSearchHighlightSegments.length > 0 ? (
          <div className="editor-search-highlights" aria-hidden="true">
            <pre
              className="editor-search-highlights-content"
              style={
                {
                  transform: `translate(${-editorScrollLeft}px, ${-editorScrollTop}px)`,
                } as CSSProperties
              }
            >
              {editorSearchHighlightSegments.map((segment, index) => (
                <span
                  key={`${segment.kind}-${index}`}
                  className={
                    segment.kind === "match"
                      ? segment.active
                        ? "editor-search-match active"
                        : "editor-search-match"
                      : "editor-search-plain"
                  }
                >
                  {segment.text}
                </span>
              ))}
            </pre>
          </div>
        ) : null}
        {visibleGitMarkers.length > 0 ? (
          <>
            <div className="editor-git-gutter" aria-label="File changes">
              {visibleGitMarkers.map((marker) => (
                <button
                  key={marker.id}
                  type="button"
                  className={
                    activeGitMarkerId === marker.id
                      ? `editor-git-marker ${marker.kind} active`
                      : `editor-git-marker ${marker.kind}`
                  }
                  aria-label={`${marker.kind} change at line ${marker.line}`}
                  onClick={() => toggleGitMarker(marker)}
                  style={
                    {
                      top: `calc(var(--editor-padding-top) + ${(marker.line - 1) * editorLineHeight}px - var(--editor-scroll-top))`,
                      height: `${Math.max(1, marker.lineCount) * editorLineHeight}px`,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
            <div className="editor-git-overview" aria-hidden="true">
              {visibleGitMarkers.map((marker) => (
                <span
                  key={`overview-${marker.id}`}
                  className={`editor-git-overview-marker ${marker.kind}`}
                  style={
                    {
                      top: `${Math.max(0, ((marker.line - 1) / Math.max(1, lines.length)) * 100)}%`,
                      height: `${Math.max(3, (marker.lineCount / Math.max(1, lines.length)) * 100)}%`,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
          </>
        ) : null}
        {activeGitMarker ? (
          <GitMarkerPopover
            left={gitPopoverLeft}
            marker={activeGitMarker}
            top={Math.min(
              Math.max(
                editorPaddingTop +
                  (activeGitMarker.line - 1) * editorLineHeight -
                  editorScrollTop,
                8,
              ),
              Math.max(8, editorViewportHeight - 190),
            )}
            onClose={() => setActiveGitMarkerId(null)}
            onMoveHorizontal={(delta: number) =>
              setGitPopoverLeftOffset((current) => current + delta)
            }
            onRevert={() => revertGitMarker(activeGitMarker)}
          />
        ) : null}
        <textarea
          ref={textareaRef}
          className="file-editor"
          spellCheck={false}
          wrap="off"
          defaultValue={content}
          onKeyDown={handleEditorKeyDown}
          onScroll={handleEditorScroll}
          onChange={(event) => onChangeDraft(event.target.value)}
        />
      </div>
      {saveError ? <div className="editor-error">{saveError}</div> : null}
    </section>
  );
}

function MediaViewToolbar({
  canShowSource,
  mediaType,
  mode,
  path,
  onChangeMode,
}: {
  canShowSource: boolean;
  mediaType: string | null;
  mode: FileViewMode;
  path: string;
  onChangeMode(mode: FileViewMode): void;
}) {
  return (
    <div className="media-view-toolbar">
      <div className="media-view-title" title={path}>
        <ImageIcon size={14} />
        <span>{fileNameFromPath(path)}</span>
        {mediaType ? <small>{mediaType}</small> : null}
      </div>
      <div className="media-view-switch" role="tablist" aria-label="File view mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "preview"}
          className={mode === "preview" ? "active" : ""}
          onClick={() => onChangeMode("preview")}
        >
          <ImageIcon size={13} />
          Preview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "source"}
          className={mode === "source" ? "active" : ""}
          disabled={!canShowSource}
          onClick={() => onChangeMode("source")}
        >
          <Code2 size={13} />
          Source
        </button>
      </div>
    </div>
  );
}

function GitMarkerPopover({
  left,
  marker,
  top,
  onClose,
  onMoveHorizontal,
  onRevert,
}: {
  left: number;
  marker: EditorGitMarker;
  top: number;
  onClose(): void;
  onMoveHorizontal(delta: number): void;
  onRevert(): void;
}) {
  const previewLines = marker.diffLines.slice(0, 12);
  const hiddenLineCount = Math.max(0, marker.diffLines.length - previewLines.length);

  function startHorizontalDrag(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    let lastClientX = event.clientX;

    function handleMove(moveEvent: PointerEvent) {
      onMoveHorizontal(moveEvent.clientX - lastClientX);
      lastClientX = moveEvent.clientX;
    }

    function stopMove() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stopMove);
      window.removeEventListener("pointercancel", stopMove);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stopMove);
    window.addEventListener("pointercancel", stopMove);
  }

  return (
    <section
      className={`editor-git-popover ${marker.kind}`}
      style={{ left, top } as CSSProperties}
      aria-label="Change details"
    >
      <div className="editor-git-popover-head" onPointerDown={startHorizontalDrag}>
        <div>
          <span>{gitMarkerLabel(marker.kind)}</span>
          <small>
            line {marker.line}, +{marker.additions} -{marker.deletions}
          </small>
        </div>
        <button
          type="button"
          className="icon-button editor-git-popover-close"
          aria-label="Close change details"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
        >
          <X size={12} />
        </button>
      </div>
      <div className="editor-git-popover-diff" role="presentation">
        {previewLines.map((line, index) => (
          <pre
            key={`${index}-${line}`}
            className={
              line.startsWith("+")
                ? "added"
                : line.startsWith("-")
                  ? "deleted"
                  : "context"
            }
          >
            {line || " "}
          </pre>
        ))}
        {hiddenLineCount > 0 ? (
          <pre className="context">... {hiddenLineCount} more lines</pre>
        ) : null}
      </div>
      <div className="editor-git-popover-actions">
        <button type="button" className="ghost-button editor-git-revert" onClick={onRevert}>
          <RotateCcw size={13} />
          Rollback change
        </button>
      </div>
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

function PullChoiceDialog({
  error,
  pending,
  projectName,
  onCancel,
  onPull,
}: {
  error: string | null;
  pending: boolean;
  projectName: string;
  onCancel(): void;
  onPull(mode: PullMode): void;
}) {
  return (
    <div className="pull-dialog-backdrop" role="presentation">
      <section className="pull-dialog" role="dialog" aria-modal="true" aria-label="Pull branch">
        <div className="pull-dialog-title">Pull current branch</div>
        <div className="pull-dialog-copy">
          Choose how to integrate remote changes for {projectName}.
        </div>
        <div className="pull-dialog-actions">
          <button
            className="ghost-button pull-action"
            disabled={pending}
            onClick={() => onPull("merge")}
          >
            {pending ? <Loader2 className="spin" size={13} /> : null}
            Merge
          </button>
          <button
            className="ghost-button pull-action"
            disabled={pending}
            onClick={() => onPull("rebase")}
          >
            Rebase
          </button>
          <button className="ghost-button pull-action quiet" disabled={pending} onClick={onCancel}>
            Cancel
          </button>
        </div>
        {error ? (
          <div className="pull-dialog-error">
            Pull stopped. Refresh is complete, check Changes for conflicts.
            <span>{error}</span>
          </div>
        ) : null}
      </section>
    </div>
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
  graphWidthCommits,
  activeCommit,
  filter,
  loading,
  onChangeFilter,
  onSelectCommit,
  onSelectWorkingTree,
}: {
  commits: CommitInfo[];
  graphWidthCommits: CommitInfo[];
  activeCommit: string | null;
  filter: string;
  loading: boolean;
  onChangeFilter(filter: string): void;
  onSelectCommit(hash: string): void;
  onSelectWorkingTree(): void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const graphRows = useMemo(() => buildCommitGraph(commits), [commits]);
  const graphWidthRows = useMemo(
    () => buildCommitGraph(graphWidthCommits),
    [graphWidthCommits],
  );
  const commitGraphWidth = useMemo(
    () =>
      Math.max(
        30,
        ...graphWidthRows.map((row) => getCommitGraphWidth(row.laneCount)),
      ),
    [graphWidthRows],
  );
  const tableStyle = {
    "--commit-graph-width": `${commitGraphWidth}px`,
  } as CSSProperties;
  const virtualizer = useVirtualizer({
    count: graphRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 28,
    getItemKey: (index) => graphRows[index]?.commit.hash ?? index,
    overscan: 16,
  });

  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    virtualizer.scrollToIndex(0, { align: "start" });
  }, [filter, graphRows.length, virtualizer]);

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
        <div
          className="commit-list-spacer"
          style={{ height: virtualizer.getTotalSize() } as CSSProperties}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const graphRow = graphRows[virtualItem.index];
            const commit = graphRow.commit;
            return (
              <div
                key={commit.hash}
                className="commit-list-virtual-row"
                data-index={virtualItem.index}
                style={{
                  transform: `translate3d(0, ${virtualItem.start}px, 0)`,
                }}
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

function wrapIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return (index + length) % length;
}

function nextMatchIndexAfter(matches: EditorTextMatch[], offset: number): number {
  if (matches.length === 0) {
    return 0;
  }

  const nextIndex = matches.findIndex((match) => match.start >= offset);
  return nextIndex >= 0 ? nextIndex : 0;
}

function buildEditorSearchHighlightSegments(
  content: string,
  matches: EditorTextMatch[],
  activeIndex: number,
): EditorSearchHighlightSegment[] {
  if (!content || matches.length === 0) {
    return [];
  }

  const segments: EditorSearchHighlightSegment[] = [];
  let cursor = 0;

  matches.forEach((match, index) => {
    const start = clamp(match.start, 0, content.length);
    const end = clamp(match.end, start, content.length);
    if (end <= cursor) {
      return;
    }

    if (start > cursor) {
      segments.push({
        kind: "plain",
        text: content.slice(cursor, start),
      });
    }

    segments.push({
      active: index === activeIndex,
      kind: "match",
      text: content.slice(start, end),
    });
    cursor = end;
  });

  if (cursor < content.length) {
    segments.push({
      kind: "plain",
      text: content.slice(cursor),
    });
  }

  return segments;
}

function loadAppSettings(): AppSettings {
  if (typeof localStorage === "undefined") {
    return defaultAppSettings;
  }

  try {
    const raw = localStorage.getItem(settingsStorageKey);
    if (!raw) {
      return defaultAppSettings;
    }

    return normalizeAppSettings(JSON.parse(raw));
  } catch {
    return defaultAppSettings;
  }
}

function saveAppSettings(settings: AppSettings) {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
}

function normalizeAppSettings(value: unknown): AppSettings {
  const record = isRecord(value) ? value : {};
  const shortcuts = isRecord(record.shortcuts) ? record.shortcuts : {};
  return {
    fontFamily:
      typeof record.fontFamily === "string" && record.fontFamily.trim()
        ? record.fontFamily
        : defaultAppSettings.fontFamily,
    fontSize: normalizePanelSize(record.fontSize, defaultAppSettings.fontSize, 10, 22),
    fontWeight:
      typeof record.fontWeight === "string" && record.fontWeight.trim()
        ? record.fontWeight
        : defaultAppSettings.fontWeight,
    lineHeight: normalizePanelSize(
      record.lineHeight,
      defaultAppSettings.lineHeight,
      1.2,
      2,
    ),
    shortcuts: shortcutRows.reduce<Record<ShortcutAction, string>>((current, row) => {
      const shortcut = shortcuts[row.action];
      const trimmedShortcut = typeof shortcut === "string" ? shortcut.trim() : "";
      return {
        ...current,
        [row.action]: trimmedShortcut
          ? trimmedShortcut
          : defaultAppSettings.shortcuts[row.action],
      };
    }, { ...defaultAppSettings.shortcuts }),
  };
}

function matchesShortcut(event: globalThis.KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) {
    return false;
  }

  const key = parts.at(-1);
  if (!key || key === "mod" || key === "ctrl" || key === "control") {
    return false;
  }

  const expectsMod = parts.includes("mod");
  const expectsCtrl = parts.includes("ctrl") || parts.includes("control");
  const expectsMeta = parts.includes("cmd") || parts.includes("meta");
  const expectsShift = parts.includes("shift");
  const expectsAlt = parts.includes("alt") || parts.includes("option");
  if (expectsMod && !(event.metaKey || event.ctrlKey)) {
    return false;
  }
  if (!expectsMod && event.metaKey !== expectsMeta) {
    return false;
  }
  if (!expectsMod && event.ctrlKey !== expectsCtrl) {
    return false;
  }
  if (event.shiftKey !== expectsShift || event.altKey !== expectsAlt) {
    return false;
  }

  return normalizeShortcutKey(event.key) === normalizeShortcutKey(key);
}

function normalizeShortcutKey(key: string): string {
  const normalized = key.trim().toLowerCase();
  if (normalized === "space") {
    return " ";
  }
  if (normalized === "esc") {
    return "escape";
  }
  if (normalized === "return") {
    return "enter";
  }
  if (normalized === "backquote") {
    return "`";
  }
  return normalized;
}

function getTextareaSelection(
  textarea: HTMLTextAreaElement | null,
): { start: number; end: number } | null {
  if (!textarea) {
    return null;
  }

  return {
    start: textarea.selectionStart,
    end: textarea.selectionEnd,
  };
}

function measureEditorLineHeight(
  style: CSSStyleDeclaration,
  fallback: number,
): number {
  const lineHeight = parseCssPixels(style.lineHeight, fallback);
  return lineHeight > 0 ? lineHeight : fallback;
}

function parseCssPixels(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function revertEditorGitMarker(content: string, marker: EditorGitMarker): string {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const hadTrailingNewline = content.endsWith("\n");
  const lines = content.split(/\r?\n/);
  if (hadTrailingNewline) {
    lines.pop();
  }

  const startIndex = Math.max(0, marker.newStart - 1);
  lines.splice(startIndex, marker.newLineCount, ...marker.oldLines);
  const nextContent = lines.join(newline);
  return hadTrailingNewline || marker.oldLines.length > 0 ? `${nextContent}${newline}` : nextContent;
}

function filterVisibleEditorGitMarkers(
  markers: EditorGitMarker[],
  content: string,
): EditorGitMarker[] {
  const lines = content.split(/\r?\n/);
  if (content.endsWith("\n")) {
    lines.pop();
  }

  return markers.filter((marker) => {
    const startIndex = Math.max(0, marker.newStart - 1);
    if (marker.newLineCount === 0) {
      return !linesMatchAt(lines, startIndex, marker.oldLines);
    }
    return linesMatchAt(lines, startIndex, marker.newLines);
  });
}

function linesMatchAt(lines: string[], startIndex: number, expected: string[]): boolean {
  if (expected.length === 0) {
    return true;
  }
  if (startIndex + expected.length > lines.length) {
    return false;
  }
  return expected.every((line, index) => lines[startIndex + index] === line);
}

function utf16OffsetForLine(content: string, lineNumber: number): number {
  if (lineNumber <= 1) {
    return 0;
  }

  let currentLine = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== "\n") {
      continue;
    }
    currentLine += 1;
    if (currentLine === lineNumber) {
      return content.slice(0, index + 1).length;
    }
  }
  return content.length;
}

function gitMarkerLabel(kind: EditorGitMarker["kind"]): string {
  switch (kind) {
    case "added":
      return "Added lines";
    case "deleted":
      return "Deleted lines";
    case "modified":
      return "Modified lines";
  }
}

function isChangedFileStatus(status: string): boolean {
  return (
    status === "added" ||
    status === "conflict" ||
    status === "modified" ||
    status === "deleted" ||
    status === "renamed" ||
    status === "untracked"
  );
}

function buildEditorGitMarkers(diff: string): EditorGitMarker[] {
  if (!diff.trim()) {
    return [];
  }

  const markers: EditorGitMarker[] = [];
  let oldLine = 1;
  let newLine = 1;
  let markerIndex = 0;
  let currentChange:
    | {
        oldStart: number;
        newStart: number;
        oldLines: string[];
        newLines: string[];
        diffLines: string[];
        additions: number;
        deletions: number;
      }
    | null = null;

  const startChange = () => {
    currentChange ??= {
      oldStart: oldLine,
      newStart: newLine,
      oldLines: [],
      newLines: [],
      diffLines: [],
      additions: 0,
      deletions: 0,
    };
    return currentChange;
  };

  const flushChange = () => {
    if (
      !currentChange ||
      (currentChange.additions === 0 && currentChange.deletions === 0)
    ) {
      currentChange = null;
      return;
    }

    const kind =
      currentChange.additions > 0 && currentChange.deletions > 0
        ? "modified"
        : currentChange.additions > 0
          ? "added"
          : "deleted";
    const oldLineCount = currentChange.oldLines.length;
    const newLineCount = currentChange.newLines.length;
    const line = Math.max(1, currentChange.newStart);
    const lineCount = Math.max(1, newLineCount || oldLineCount);
    markers.push({
      id: `${currentChange.oldStart}-${oldLineCount}-${currentChange.newStart}-${newLineCount}-${markerIndex}`,
      line,
      lineCount,
      oldStart: currentChange.oldStart,
      oldLineCount,
      newStart: currentChange.newStart,
      newLineCount,
      additions: currentChange.additions,
      deletions: currentChange.deletions,
      kind,
      oldLines: currentChange.oldLines,
      newLines: currentChange.newLines,
      diffLines: currentChange.diffLines,
    });
    markerIndex += 1;
    currentChange = null;
  };

  for (const line of diff.split("\n")) {
    const hunkMatch = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunkMatch) {
      flushChange();
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[3]);
      continue;
    }

    if (line.startsWith("diff --git ") || line.startsWith("+++ ") || line.startsWith("--- ")) {
      flushChange();
      continue;
    }

    if (line.startsWith("+")) {
      const value = line.slice(1);
      const change = startChange();
      change.newLines.push(value);
      change.diffLines.push(line);
      change.additions += 1;
      newLine += 1;
      continue;
    }

    if (line.startsWith("-")) {
      const value = line.slice(1);
      const change = startChange();
      change.oldLines.push(value);
      change.diffLines.push(line);
      change.deletions += 1;
      oldLine += 1;
      continue;
    }

    if (line.startsWith(" ")) {
      flushChange();
      oldLine += 1;
      newLine += 1;
      continue;
    }
  }

  flushChange();
  return markers;
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

function buildRequestedFilePath(parentPath: string | null, input: string): string | null {
  const normalizedInput = input.trim().replaceAll("\\", "/");
  if (!normalizedInput) {
    return null;
  }

  if (normalizedInput.startsWith("/")) {
    return normalizedInput.replace(/^\/+/, "");
  }

  if (!parentPath) {
    return normalizedInput;
  }

  return `${parentPath.replace(/\/+$/, "")}/${normalizedInput}`;
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

function gitConflictToMarkerFile(path: string, content: string): FileContents {
  return {
    name: path,
    contents: content,
  };
}

function hasGitConflictMarkers(content: string): boolean {
  return (
    content.includes("<<<<<<<") &&
    content.includes("=======") &&
    content.includes(">>>>>>>")
  );
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
