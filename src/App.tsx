import {
  type CSSProperties,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  FolderOpen,
  Loader2,
} from "lucide-react";
import { CommandPanel } from "./components/CommandPanel";
import { DiffPanel } from "./components/DiffPanel";
import { PreviewTabBar } from "./components/PreviewTabBar";
import { ProjectRail } from "./components/ProjectRail";
import { RailDockOverlay } from "./components/RailDockOverlay";
import { ProjectSideRail } from "./components/ProjectSideRail";
import { ProjectTreeTitle } from "./components/ProjectTreeTitle";
import { PullChoiceDialog } from "./components/PullChoiceDialog";
import { ResizeHandle } from "./components/ResizeHandle";
import { WindowControls } from "./components/WindowControls";
import type { TreeGitFileActions } from "./components/TreeContextMenu";
import { CodeMirrorFilePreview } from "./components/editor/CodeMirrorFilePreview";
import { PreviewDebugPage } from "./components/editor/PreviewDebugPage";
import {
  type GitAvailability,
  type GitPanelDataProps,
} from "./components/workbench/GitPanels";
import {
  ProjectFileTreePanel,
  type ProjectFileTreePanelProps,
} from "./components/workbench/ProjectFileTreePanel";
import { WorkbenchRailSlotStack } from "./components/workbench/WorkbenchRailSlotStack";
import { useAppKeyboardShortcuts } from "./hooks/useAppKeyboardShortcuts";
import { useAppSettingsState } from "./hooks/useAppSettingsState";
import { useCommandPanel } from "./hooks/useCommandPanel";
import { useEditorDrafts } from "./hooks/useEditorDrafts";
import { useGitActions } from "./hooks/useGitActions";
import { useGitFileActions } from "./hooks/useGitFileActions";
import { useGitWriteGuard } from "./hooks/useGitWriteGuard";
import { useGitWriteActions } from "./hooks/useGitWriteActions";
import { usePreviewTabs } from "./hooks/usePreviewTabs";
import { useProjectFileActions } from "./hooks/useProjectFileActions";
import { useProjectFilesystemPolling } from "./hooks/useProjectFilesystemPolling";
import { useProjectSelectionActions } from "./hooks/useProjectSelectionActions";
import { useRepositoryRemotePolling } from "./hooks/useRepositoryRemotePolling";
import {
  useRepositoryPreviewData,
  useRepositoryProjectData,
} from "./hooks/useRepositoryWorkspaceData";
import { useSelectedPathGuard } from "./hooks/useSelectedPathGuard";
import { useWorkbenchDock } from "./hooks/useWorkbenchDock";
import { type FileSearchResult, type ProjectScript, detectProjectScripts, type ReflogEntry } from "./lib/api";
import { pasteDestinationFromSelectedPath } from "./lib/clipboardFiles";
import {
  type SavedProject,
  loadSavedProjects,
  projectNameFromPath,
  saveProjects,
} from "./lib/projects";
import { clamp } from "./lib/numeric";
import { projectRootFromPayload } from "./lib/repositoryPayload";
import {
  buildRailBottomPanelsStyle,
  buildRailWorkbenchGridStyle,
} from "./lib/workbenchLayout";
import { runInTerminal } from "./lib/terminalSessions";
import type {
  RailItemId,
  RailLayout,
  RailSlot,
  RailSide,
  PanelSizes,
  ToolPanelId,
} from "./lib/workbenchTypes";

type RailPanelSizeKey = "leftTop" | "rightTop" | "bottom" | "bottomLeft";

type RailGridStyle = CSSProperties & {
  readonly "--rail-left-top-width": string;
  readonly "--rail-right-top-width": string;
  readonly "--rail-bottom-height": string;
  readonly "--rail-bottom-left-width": string;
};

const MemoProjectFileTreePanel = memo(function MemoProjectFileTreePanel(
  props: ProjectFileTreePanelProps,
) {
  return <ProjectFileTreePanel {...props} />;
});

// App is a legacy orchestration shell (see AGENTS.md); splitting it is a
// separate, behavior-sensitive refactor tracked outside this cleanup.
// oxlint-disable-next-line react-doctor/no-giant-component, react-doctor/prefer-useReducer
export function App() {
  const queryClient = useQueryClient();
  const [projects, setProjects] = useState<SavedProject[]>(() =>
    loadSavedProjects(),
  );
  const { appSettings, appShellStyle } = useAppSettingsState();
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    () => loadSavedProjects()[0]?.id ?? null,
  );
  const [activeBranchRef, setActiveBranchRef] = useState<string | null>(null);
  const [activeCommit, setActiveCommit] = useState<string | null>(null);
  const [activeReflogSelector, setActiveReflogSelector] = useState<string | null>(null);
  const [selectedProjectPath, setSelectedProjectPath] = useState<string | null>(null);
  const [selectedChangePath, setSelectedChangePath] = useState<string | null>(null);
  const [commitFilter, setCommitFilter] = useState("");
  const [reflogFilter, setReflogFilter] = useState("");
  const [historyMode, setHistoryMode] = useState<"commits" | "reflog">("commits");
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false);
  const {
    draggedGitPanel,
    gitPanelOrder,
    panelSizes,
    railActiveItems,
    railLayout,
    draggedRailItem,
    clearDockDrag,
    dropRailItem,
    moveGitPanel,
    reattachGitPanel,
    resizePanel,
    selectRailItem,
    startGitPanelDrag,
    startRailItemDrag,
  } = useWorkbenchDock();
  const contentGridRef = useRef<HTMLDivElement | null>(null);
  const panelSizesRef = useRef(panelSizes);
  const railPanelPreviewRef = useRef<Partial<Record<RailPanelSizeKey, number>>>(
    {},
  );
  panelSizesRef.current = panelSizes;

  const activeProject = projects.find(
    (project: SavedProject) => project.id === activeProjectId,
  );
  const activeProjectPath = activeProject?.activePath ?? null;
  const {
    commandMode,
    commandOpen,
    commandQuery,
    commandSelectionIndex,
    debouncedCommandQuery,
    closeCommandPanel,
    openCommandPanel,
    setCommandQuery,
    setCommandSelectionIndex,
  } = useCommandPanel({
    activeProjectPath,
  });
  // Persist the saved-projects list whenever it changes. projects is also
  // updated by the repository-loaded effect below, but persistence is the
  // dedicated side effect for that state and can't move into the loader.
  // oxlint-disable-next-line react-doctor/no-effect-chain
  useEffect(() => {
    saveProjects(projects);
  }, [projects]);

  const {
    changedFiles,
    commandResults,
    commits,
    commitsQuery,
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
  } = useRepositoryProjectData({
    activeBranchRef,
    activeCommit,
    activeProjectPath,
    commandMode,
    commandOpen,
    commitFilter,
    debouncedCommandQuery,
    reflogFilter,
    selectedProjectPath,
  });
  const gitAvailability: GitAvailability =
    payload && !repositoryQuery.isPlaceholderData
      ? payload.summary.isGitRepo
        ? "git"
        : "non-git"
      : "loading";
  const hasGitRepository = gitAvailability === "git";
  const handleFileSaved = useCallback(
    async (projectPath: string, filePath: string) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["file-content", projectPath, filePath],
        }),
        queryClient.invalidateQueries({
          queryKey: ["changed-files", projectPath],
        }),
        queryClient.invalidateQueries({
          queryKey: ["project-files", projectPath],
        }),
        queryClient.invalidateQueries({
          queryKey: ["repository", projectPath],
        }),
      ]);
    },
    [queryClient],
  );
  const {
    activeEditorDraft,
    editorDrafts,
    saveError,
    savingActiveFile,
    confirmDiscardProjectDrafts,
    discardConflictToDisk,
    discardDraftByKey,
    discardDraftForPath,
    discardDraftsForProject,
    isFileDraftDirty,
    moveEditorDraftPath,
    saveActiveFile,
    setConflictDraftContent,
    updateEditorDraft,
  } = useEditorDrafts({
    activeProjectPath,
    currentFileContent,
    selectedProjectPath,
    onFileSaved: handleFileSaved,
  });
  const {
    activePreviewTabId,
    dirtyPreviewTabIds,
    previewMode,
    previewTabs,
    previewTarget,
    activateAdjacentTab,
    activatePreviewTab,
    clearPreviewTabs,
    closeAllTabs,
    closeOtherTabs,
    closePreviewTab,
    movePreviewTabPath,
    openPreviewTab,
    removePreviewTabsForPath,
    reorderPreviewTabs,
    showDiffSelection,
  } = usePreviewTabs({
    activeCommit,
    activeProjectPath,
    editorDrafts,
    selectedProjectPath,
    onDiscardDraft: discardDraftByKey,
    onSelectChangePath: setSelectedChangePath,
    onSelectCommit: setActiveCommit,
    onSelectProjectPath: setSelectedProjectPath,
  });
  const gitWriteGuard = useGitWriteGuard();
  const {
    canRunGitFileAction,
    gitFileActionPending,
    gitFileActionPendingTitle,
    restoreFile,
    stageFile,
    unstageFile,
  } = useGitFileActions({
    activeProject,
    discardDraftForPath,
    editorDrafts,
    gitWriteGuard,
    hasGitRepository,
    removePreviewTabsForPath,
    selectedProjectPath,
    setSelectedProjectPath,
  });
  const gitWriteActions = useGitWriteActions({
    activeProject,
    editorDrafts,
    gitWriteGuard,
    hasGitRepository,
    repositoryPayload: payload,
  });
  const {
    currentFileBlame,
    currentFileDiff,
    diffStats,
    editorGitMarkers,
    fileBlameQuery,
    fileDiffQuery,
    fileWorktreeDiffQuery,
    parsedDiff,
    visibleDiffFiles,
  } = useRepositoryPreviewData({
    activeCommit,
    activeProjectPath,
    fileContentReady: currentFileContent !== null,
    hasGitRepository,
    previewMode,
    selectedChangePath,
    selectedProjectPath,
    selectedProjectStatus,
  });
  const {
    chooseRepository,
    removeProject,
    selectProject,
  } = useProjectSelectionActions({
    activeProject,
    activeProjectId,
    clearPreviewTabs,
    confirmDiscardProjectDrafts,
    discardDraftsForProject,
    projects,
    setActiveBranchRef,
    setActiveCommit,
    setActiveProjectId,
    setProjectSwitcherOpen,
    setProjects,
    setSelectedChangePath,
    setSelectedProjectPath,
  });
  const {
    copyFileFromTree,
    createFileFromTree,
    deleteFileFromTree,
    pasteClipboardFromTree,
    pasteFilesFromTree,
    refreshProjectFileState,
    renameFileFromTree,
  } = useProjectFileActions({
    activeProject,
    discardDraftForPath,
    isFileDraftDirty,
    moveEditorDraftPath,
    movePreviewTabPath,
    openPreviewTab,
    removePreviewTabsForPath,
    selectedProjectPath,
    setSelectedProjectPath,
  });
  const {
    openPullChoice,
    performBranchAction,
    performPull,
    pullChoiceOpen,
    pullError,
    pullPending,
    setPullChoiceOpen,
  } = useGitActions({
    activeBranchRef,
    activeProject,
    confirmDiscardProjectDrafts,
    discardDraftsForProject,
    hasGitRepository,
    refetchCommits: commitsQuery.refetch,
    refetchReflog: reflogQuery.refetch,
    refetchFileWorktreeDiff: fileWorktreeDiffQuery.refetch,
    refetchProjectFiles: projectFilesQuery.refetch,
      refetchRepository: repositoryQuery.refetch,
      refreshProjectFileState,
      setActiveBranchRef,
      setActiveCommit,
    setSelectedChangePath,
    showDiffSelection,
    });

  // Reset the reflog selection when the project changes; the selector has no
  // stable identity across projects so it's cleared rather than derived.
  useEffect(() => {
    /* oxlint-disable react-doctor/no-derived-state-effect, react-doctor/no-chain-state-updates, react-doctor/no-adjust-state-on-prop-change */
    setActiveReflogSelector(null);
    /* oxlint-enable react-doctor/no-derived-state-effect, react-doctor/no-chain-state-updates, react-doctor/no-adjust-state-on-prop-change */
  }, [activeProjectPath]);

  const selectedReflogEntry = useMemo(
    () =>
      activeReflogSelector
        ? reflogEntries.find((entry) => entry.selector === activeReflogSelector) ?? null
        : null,
    [activeReflogSelector, reflogEntries],
  );

  // Sync the active project's root/name into the persisted projects list when
  // the repository loads. projects is persisted state (localStorage) merged
  // with repo-derived metadata, so it can't be a pure derivation.
  useEffect(() => {
    /* oxlint-disable react-doctor/no-derived-state */
    const payload = repositoryQuery.data;
    if (!payload || !activeProject) {
      return;
    }

    const rootPath = projectRootFromPayload(payload);
    const name = projectNameFromPath(rootPath);
    setProjects((current: SavedProject[]) => {
      let changed = false;
      const nextProjects = current.map((project: SavedProject) => {
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
    /* oxlint-enable react-doctor/no-derived-state */
  }, [activeProject, repositoryQuery.data]);

  const leftTopItems = railLayout.left.top;
  const leftBottomItems = railLayout.left.bottom;
  const rightTopItems = railLayout.right.top;
  const rightBottomItems = railLayout.right.bottom;
  const leftTopActiveItem = railActiveItems.left.top;
  const leftBottomActiveItem = railActiveItems.left.bottom;
  const rightTopActiveItem = railActiveItems.right.top;
  const rightBottomActiveItem = railActiveItems.right.bottom;
  const hasLeftTopPanel =
    leftTopActiveItem !== null && leftTopItems.includes(leftTopActiveItem);
  const hasLeftBottomPanel =
    leftBottomActiveItem !== null && leftBottomItems.includes(leftBottomActiveItem);
  const hasRightTopPanel =
    rightTopActiveItem !== null && rightTopItems.includes(rightTopActiveItem);
  const hasRightBottomPanel =
    rightBottomActiveItem !== null &&
    rightBottomItems.includes(rightBottomActiveItem);
  const hasBottomPanels = hasLeftBottomPanel || hasRightBottomPanel;
  const contentGridStyle = useMemo<RailGridStyle>(
    () => ({
      ...buildRailWorkbenchGridStyle(
        hasLeftTopPanel,
        hasRightTopPanel,
        hasBottomPanels,
      ),
      "--rail-left-top-width": `${panelSizes.leftTop}px`,
      "--rail-right-top-width": `${panelSizes.rightTop}px`,
      "--rail-bottom-height": `${panelSizes.bottom}px`,
      "--rail-bottom-left-width": `${panelSizes.bottomLeft}px`,
    }),
    [
      hasBottomPanels,
      hasLeftTopPanel,
      hasRightTopPanel,
      panelSizes.bottom,
      panelSizes.bottomLeft,
      panelSizes.leftTop,
      panelSizes.rightTop,
    ],
  );
  const bottomPanelsStyle = hasBottomPanels
    ? buildRailBottomPanelsStyle(
        hasLeftBottomPanel,
        hasRightBottomPanel,
      )
    : undefined;
  const dockedGitPanelOrder = gitPanelOrder;
  const projectTreeTitle = useMemo(
    () =>
      activeProject ? (
        <ProjectTreeTitle path={activeProject.activePath} />
      ) : (
        "Project"
      ),
    [activeProject],
  );
  const handleProjectTreeCreateFile = useCallback((parentPath: string | null) => {
    void createFileFromTree(parentPath);
  }, [createFileFromTree]);
  const handleProjectTreePasteFiles = useCallback(
    (files: File[], destDir: string | null) => {
      void pasteFilesFromTree(files, destDir);
    },
    [pasteFilesFromTree],
  );
  const handleProjectTreeCopyFile = useCallback(() => {
    void copyFileFromTree(selectedProjectFile?.path ?? null);
  }, [copyFileFromTree, selectedProjectFile?.path]);
  const handleProjectTreeDeleteFile = useCallback((path: string) => {
    void deleteFileFromTree(path);
  }, [deleteFileFromTree]);
  const handleProjectTreeRenameFile = useCallback(
    (fromPath: string, toPath: string) => {
      void renameFileFromTree(fromPath, toPath);
    },
    [renameFileFromTree],
  );
  const handleProjectTreeSelectPath = useCallback(
    (path: string) => {
      openPreviewTab("file", path);
    },
    [openPreviewTab],
  );
  const [runScriptState, setRunScriptState] = useState<{
    loading: boolean;
    scripts: ProjectScript[];
    error: string | null;
  }>({ loading: false, scripts: [], error: null });

  const handleRunScript = useCallback(() => {
    if (!activeProjectPath) {
      return;
    }
    setRunScriptState({ loading: true, scripts: [], error: null });
    detectProjectScripts(activeProjectPath)
      .then((scripts) => {
        if (scripts.length === 0) {
          setRunScriptState({
            loading: false,
            scripts: [],
            error: "No project scripts found. Open a project with package.json, Cargo.toml, Makefile, deno.json, or go.mod.",
          });
          return;
        }
        setRunScriptState({ loading: false, scripts, error: null });
      })
      .catch((error) => {
        setRunScriptState({
          loading: false,
          scripts: [],
          error: String(error ?? "Failed to detect project scripts"),
        });
      });
  }, [activeProjectPath]);

  const handleSelectScript = useCallback(
    (script: ProjectScript) => {
      if (!activeProjectPath) {
        return;
      }
      runInTerminal(activeProjectPath, script.command, script.label);
      setRunScriptState({ loading: false, scripts: [], error: null });
      // Switch to terminal panel
      const placement = findRailItemPlacement(railLayout, "terminal");
      if (placement) {
        selectRailItem(placement.side, placement.slot, "terminal");
      }
    },
    [activeProjectPath, railLayout, selectRailItem],
  );
  const clearSelectedProjectPath = useCallback(() => {
    setSelectedProjectPath(null);
  }, []);
  const clearSelectedChangePath = useCallback(() => {
    setSelectedChangePath(null);
  }, []);
  const toggleProjectSwitcher = useCallback(() => {
    setProjectSwitcherOpen((open: boolean) => !open);
  }, []);
  const closeProjectSwitcher = useCallback(() => {
    setProjectSwitcherOpen(false);
  }, []);
  const closePullChoice = useCallback(() => {
    setPullChoiceOpen(false);
  }, [setPullChoiceOpen]);
  const changeHistoryMode = useCallback((mode: "commits" | "reflog") => {
    setHistoryMode(mode);
    if (mode === "commits") {
      setActiveReflogSelector(null);
    }
  }, []);
  const saveActivePreviewFile = useCallback(() => {
    void saveActiveFile();
  }, [saveActiveFile]);

  useSelectedPathGuard({
    items: projectFilesQuery.data,
    placeholder: projectFilesQuery.isPlaceholderData,
    selectedPath: selectedProjectPath,
    onClear: clearSelectedProjectPath,
  });
  useAppKeyboardShortcuts({
    canUseProjectCommands: Boolean(activeProject),
    commandOpen,
    hasActiveEditorDraft: Boolean(activeEditorDraft),
    hasActiveTab: previewTabs.length > 0 && activePreviewTabId !== null,
    pullChoiceOpen,
    previewMode,
    shortcuts: appSettings.shortcuts,
    onCloseActiveTab: () => {
      if (activePreviewTabId) closePreviewTab(activePreviewTabId);
    },
    onCloseCommandPanel: closeCommandPanel,
    onClosePullChoice: closePullChoice,
    onOpenCommandPanel: () => openCommandPanel("files"),
    onOpenFindFiles: () => openCommandPanel("files"),
    onOpenFindInFiles: () => openCommandPanel("content"),
    onOpenPullChoice: openPullChoice,
    onSaveActiveFile: saveActivePreviewFile,
    onSelectToolPanelView: (view: ToolPanelId) => {
      const item =
        view === "project"
          ? "fileTree"
          : view === "terminal"
            ? "terminal"
            : "git";
      const placement = findRailItemPlacement(railLayout, item);
      if (placement) {
        selectRailItem(placement.side, placement.slot, item);
      }
    },
    onSwitchTab: activateAdjacentTab,
    onToggleProjectSwitcher: toggleProjectSwitcher,
    onJumpToDiffFile: () => {
      const activeTab = previewTabs.find((tab) => tab.id === activePreviewTabId);
      if (activeTab?.mode === "diff") {
        openPreviewTab("file", activeTab.path);
      }
    },
  });

  useSelectedPathGuard({
    items: changedFiles,
    placeholder: repositoryQuery.isPlaceholderData,
    selectedPath: selectedChangePath,
    onClear: clearSelectedChangePath,
  });
  useRepositoryRemotePolling({
    activeProjectPath,
    hasGitRepository,
    refetchCommits: commitsQuery.refetch,
    refetchProjectFiles: projectFilesQuery.refetch,
    refetchRepository: repositoryQuery.refetch,
  });
  useProjectFilesystemPolling({
    activeProjectPath,
  });

  function openFileSearchResult(result: FileSearchResult) {
    const matchColumn = result.matchRanges.length > 0 ? result.matchRanges[0][0] : 0;
    openPreviewTab("file", result.path, result.lineNumber, matchColumn);
    closeCommandPanel();
  }

  const selectBranchRef = useCallback(
    (refName: string) => {
      setActiveBranchRef(refName);
      setActiveCommit(null);
      setActiveReflogSelector(null);
      setSelectedChangePath(null);
      showDiffSelection();
    },
    [showDiffSelection],
  );

  const selectCommit = useCallback(
    (hash: string) => {
      setActiveCommit(hash);
      setActiveReflogSelector(null);
      setSelectedChangePath(null);
      showDiffSelection();
    },
    [showDiffSelection],
  );

  const selectReflogEntry = useCallback(
    (entry: ReflogEntry) => {
      setActiveCommit(entry.hash);
      setActiveReflogSelector(entry.selector);
      setSelectedChangePath(null);
      showDiffSelection();
    },
    [showDiffSelection],
  );

  const selectWorkingTree = useCallback(() => {
    setActiveCommit(null);
    setActiveReflogSelector(null);
    setSelectedChangePath(null);
    showDiffSelection();
  }, [showDiffSelection]);
  const restoreReflogEntry = useCallback(
    async (selector: string) => {
      const restored = await gitWriteActions.resetHardToReflogEntry(selector);
      if (!restored) {
        return;
      }

      setActiveCommit(null);
      setActiveReflogSelector(null);
      setSelectedChangePath(null);
      showDiffSelection();
    },
    [gitWriteActions, showDiffSelection],
  );
  const openDiffPreviewPath = useCallback(
    (path: string) => {
      openPreviewTab("diff", path);
    },
    [openPreviewTab],
  );
  const resizeCommitInfo = useCallback(
    (delta: number) => {
      resizePanel("commitInfo", -delta, 110, 360);
    },
    [resizePanel],
  );
  const treeGitFileActions = useMemo<TreeGitFileActions>(
    () => ({
      canRun: canRunGitFileAction,
      pendingKind: gitFileActionPending?.kind ?? null,
      pendingPath: gitFileActionPending?.path ?? null,
      pendingTitle: gitFileActionPendingTitle,
      onRestoreFile: (path: string) => {
        void restoreFile(path);
      },
      onStageFile: (path: string) => {
        void stageFile(path);
      },
      onUnstageFile: (path: string) => {
        void unstageFile(path);
      },
    }),
    [
      canRunGitFileAction,
      gitFileActionPending?.kind,
      gitFileActionPending?.path,
      gitFileActionPendingTitle,
      restoreFile,
      stageFile,
      unstageFile,
    ],
  );
  const activeTreeGitFileActions = hasGitRepository
    ? treeGitFileActions
    : undefined;

  const gitPanelData = useMemo<GitPanelDataProps>(
    () => ({
      activeCommit,
      activeReflogSelector,
      changedFiles,
      commitFilter,
      commits,
      commitsLoading: commitsQuery.isLoading,
      filteredCommits,
      gitFileActions: activeTreeGitFileActions,
      historyMode,
      gitWriteActions,
      payload,
      reflogEntries,
      reflogFilter,
      reflogLoading: reflogQuery.isLoading,
      selectedBranch,
      selectedBranchRef,
      selectedChangePath,
      selectedCommit,
      selectedReflogEntry,
      onBranchAction: performBranchAction,
      onChangeCommitFilter: setCommitFilter,
      onChangeHistoryMode: changeHistoryMode,
      onChangeReflogFilter: setReflogFilter,
      onOpenDiffPath: openDiffPreviewPath,
      onResizeCommitInfo: resizeCommitInfo,
      onSelectBranch: selectBranchRef,
      onSelectCommit: selectCommit,
      onSelectReflogEntry: selectReflogEntry,
      onSelectWorkingTree: selectWorkingTree,
      onRestoreReflogEntry: restoreReflogEntry,
    }),
    [
      activeCommit,
      activeReflogSelector,
      changedFiles,
      changeHistoryMode,
      commitFilter,
      commits,
      commitsQuery.isLoading,
      filteredCommits,
      gitWriteActions,
      historyMode,
      openDiffPreviewPath,
      payload,
      performBranchAction,
      reflogEntries,
      reflogFilter,
      reflogQuery.isLoading,
      resizeCommitInfo,
      restoreReflogEntry,
      selectBranchRef,
      selectCommit,
      selectReflogEntry,
      selectWorkingTree,
      selectedBranch,
      selectedBranchRef,
      selectedChangePath,
      selectedCommit,
      selectedReflogEntry,
      setReflogFilter,
      activeTreeGitFileActions,
    ],
  );
  const projectTreeEmptyCopy =
    hasGitRepository
      ? "Tracked and untracked files will appear here."
      : "Files in this folder will appear here.";

  const projectTreeContent = (
    <MemoProjectFileTreePanel
      emptyCopy={projectTreeEmptyCopy}
      files={projectFilesQuery.data}
      selectedPath={selectedProjectPath}
      title={projectTreeTitle}
      gitFileActions={activeTreeGitFileActions}
      onCreateFile={handleProjectTreeCreateFile}
      onDeleteFile={handleProjectTreeDeleteFile}
      onPasteFiles={handleProjectTreePasteFiles}
      onRenameFile={handleProjectTreeRenameFile}
      onRunScript={handleRunScript}
      onSelectPath={handleProjectTreeSelectPath}
    />
  );

  useEffect(() => {
    if (!activeProject) {
      return;
    }

    function handleProjectFileClipboardShortcut(event: globalThis.KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        isPasteImportBlockedTarget(event.target) ||
        !(event.ctrlKey || event.metaKey) ||
        event.altKey
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "c" && selectedProjectFile) {
        event.preventDefault();
        handleProjectTreeCopyFile();
        return;
      }

      if (key === "v") {
        event.preventDefault();
        const destDir = pasteDestinationFromSelectedPath(selectedProjectPath);
        void pasteClipboardFromTree(destDir);
      }
    }

    window.addEventListener("keydown", handleProjectFileClipboardShortcut);
    return () =>
      window.removeEventListener("keydown", handleProjectFileClipboardShortcut);
  }, [
    activeProject,
    handleProjectTreeCopyFile,
    pasteClipboardFromTree,
    selectedProjectFile,
    selectedProjectPath,
  ]);

  useLayoutEffect(() => {
    syncRailPanelSizeVars(contentGridRef.current, panelSizes);
  }, [panelSizes]);

  const previewRailPanelResize = useCallback(
    (key: RailPanelSizeKey, delta: number, min: number, max: number) => {
      const currentSize =
        railPanelPreviewRef.current[key] ?? panelSizesRef.current[key];
      const nextSize = clamp(currentSize + delta, min, max);
      if (nextSize === currentSize) {
        return;
      }

      railPanelPreviewRef.current[key] = nextSize;
      applyRailPanelSizeVar(contentGridRef.current, key, nextSize);
    },
    [],
  );

  const commitRailPanelResize = useCallback(
    (key: RailPanelSizeKey, totalDelta: number, min: number, max: number) => {
      const previewSize = railPanelPreviewRef.current[key];
      delete railPanelPreviewRef.current[key];

      const baseSize = panelSizesRef.current[key];
      const nextSize =
        typeof previewSize === "number"
          ? previewSize
          : clamp(baseSize + totalDelta, min, max);
      const delta = nextSize - baseSize;

      applyRailPanelSizeVar(contentGridRef.current, key, nextSize);
      if (delta !== 0) {
        resizePanel(key, delta, min, max);
      }
    },
    [resizePanel],
  );

  const handleResizeLeftTop = useCallback(
    (delta: number) => {
      previewRailPanelResize("leftTop", delta, 220, 560);
    },
    [previewRailPanelResize],
  );
  const handleResizeLeftTopEnd = useCallback(
    (delta: number) => {
      commitRailPanelResize("leftTop", delta, 220, 560);
    },
    [commitRailPanelResize],
  );
  const handleResizeRightTop = useCallback(
    (delta: number) => {
      previewRailPanelResize("rightTop", -delta, 220, 560);
    },
    [previewRailPanelResize],
  );
  const handleResizeRightTopEnd = useCallback(
    (delta: number) => {
      commitRailPanelResize("rightTop", -delta, 220, 560);
    },
    [commitRailPanelResize],
  );
  const handleResizeBottom = useCallback(
    (delta: number) => {
      previewRailPanelResize("bottom", -delta, 180, 560);
    },
    [previewRailPanelResize],
  );
  const handleResizeBottomEnd = useCallback(
    (delta: number) => {
      commitRailPanelResize("bottom", -delta, 180, 560);
    },
    [commitRailPanelResize],
  );
  const handleResizeBottomLeft = useCallback(
    (delta: number) => {
      previewRailPanelResize("bottomLeft", delta, 260, 1400);
    },
    [previewRailPanelResize],
  );
  const handleResizeBottomLeftEnd = useCallback(
    (delta: number) => {
      commitRailPanelResize("bottomLeft", delta, 260, 1400);
    },
    [commitRailPanelResize],
  );

  const isRailItemActive = useCallback(
    (side: "left" | "right") => (item: RailItemId) => {
      return (
        railActiveItems[side].top === item || railActiveItems[side].bottom === item
      );
    },
    [railActiveItems],
  );

  const handleSelectRailItem = useCallback(
    (side: "left" | "right") => (item: RailItemId, slot: "top" | "bottom") => {
      selectRailItem(side, slot, item);
    },
    [selectRailItem],
  );

  const shellStyle = {
    ...appShellStyle,
    gridTemplateColumns: "48px minmax(0, 1fr) 48px",
    gridTemplateRows: "35px minmax(0, 1fr)",
  };
  const previewDebugEnabled =
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("preview-debug") === "1";

  if (previewDebugEnabled) {
    return <PreviewDebugPage shellStyle={appShellStyle} />;
  }

  return (
    <main className="app-shell" style={shellStyle}>
      {activeProject ? (
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
          onCloseOtherTabs={closeOtherTabs}
          onCloseAllTabs={closeAllTabs}
          onReorderTabs={reorderPreviewTabs}
          onSelectTab={activatePreviewTab}
          previewMode={previewMode}
          projectPath={activeProject.activePath}
          selectedPath={
            previewMode === "diff" ? selectedChangePath : selectedProjectPath
          }
          tabs={previewTabs}
          dirtyTabIds={dirtyPreviewTabIds}
        />
      ) : null}
      <ProjectRail
        activeProjectId={activeProjectId}
        activeProjectName={activeProject?.name ?? null}
        draggedRailItem={draggedRailItem}
        hasActiveProject={Boolean(activeProject)}
        isActiveItem={isRailItemActive("left")}
        projectSwitcherOpen={projectSwitcherOpen}
        projects={projects}
        railLayout={railLayout}
        onChooseRepository={chooseRepository}
        onCloseProjectSwitcher={closeProjectSwitcher}
        onRemoveProject={removeProject}
        onSelectProject={selectProject}
        onDropRailItem={(item, slot) => dropRailItem(item, "left", slot)}
        onSelectRailItem={handleSelectRailItem("left")}
        onStartRailItemDrag={startRailItemDrag}
        onToggleProjectSwitcher={toggleProjectSwitcher}
      />

      {pullChoiceOpen ? (
        <PullChoiceDialog
          error={pullError}
          pending={pullPending}
          projectName={activeProject?.name ?? "current project"}
          onCancel={closePullChoice}
          onPull={(mode) => void performPull(mode)}
        />
      ) : null}

      {runScriptState.loading || runScriptState.scripts.length > 0 || runScriptState.error ? (
        <div
          className="command-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setRunScriptState({ loading: false, scripts: [], error: null });
            }
          }}
        >
          <section className="command-panel" style={{ maxHeight: "min(420px, calc(100vh - 72px))" }}>
            <div className="command-context">
              <span>Run project scripts</span>
              <kbd>Esc</kbd>
            </div>
            <div className="command-results">
              {runScriptState.loading ? (
                <div className="command-empty">
                  <div className="empty-title">Detecting scripts…</div>
                </div>
              ) : runScriptState.error ? (
                <div className="command-empty">
                  <div className="empty-title">No scripts found</div>
                  <div className="empty-copy">{runScriptState.error}</div>
                </div>
              ) : (
                runScriptState.scripts.map((script) => (
                  <button
                    key={`${script.source}:${script.label}`}
                    className="command-result command-result-file"
                    type="button"
                    onClick={() => handleSelectScript(script)}
                  >
                    <span className="command-result-main">
                      <span>{script.label}</span>
                      <small>{script.command}</small>
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}

      <section className="workspace">
        {!activeProject ? (
          <div className="welcome-surface">
            <div className="welcome-drag-strip" data-tauri-drag-region />
            <div className="welcome-icon">
              <FolderOpen size={26} />
            </div>
            <h1>Open a folder</h1>
            <p>
              View keeps multiple folders in the rail and unlocks Git history
              automatically when a folder is a repository.
            </p>
            <button type="button" className="primary-action compact" onClick={chooseRepository}>
             <FolderOpen size={16} />
             Choose folder
            </button>
            <div className="welcome-controls">
              <WindowControls />
            </div>
          </div>
        ) : repositoryQuery.isError ? (
          <div className="error-surface">
            <div className="welcome-drag-strip" data-tauri-drag-region />
            <div className="error-title">Project could not be loaded</div>
            <pre>{String(repositoryQuery.error.message)}</pre>
            <div className="welcome-controls">
              <WindowControls />
            </div>
          </div>
        ) : (
          <div
            className="content-grid"
            ref={contentGridRef}
            style={contentGridStyle}
          >
            {hasLeftTopPanel ? (
              <>
                <WorkbenchRailSlotStack
                  activeItem={leftTopActiveItem}
                  activeProjectPath={activeProject?.activePath ?? null}
                  gitAvailability={gitAvailability}
                  dockedGitPanelOrder={dockedGitPanelOrder}
                  draggedGitPanel={draggedGitPanel}
                  gitPanelData={gitPanelData}
                  items={railLayout.left.top}
                  branchSize={panelSizes.branch}
                  commitDetailSize={panelSizes.commitInfo}
                  detailsSize={panelSizes.details}
                  projectTreeContent={projectTreeContent}
                  side="left"
                  slot="top"
                  onDragEnd={clearDockDrag}
                  onDragStart={startGitPanelDrag}
                  onDropPanel={moveGitPanel}
                  onReattachPanel={reattachGitPanel}
                  resizePanel={resizePanel}
                />
                <ResizeHandle
                  axis="x"
                  className="rail-left-top-splitter"
                  label="Resize left rail slot"
                  onResize={handleResizeLeftTop}
                  onResizeEnd={handleResizeLeftTopEnd}
                />
              </>
            ) : null}

            <section className="diff-panel rail-editor-panel">
             {previewMode === "file" ? (
                  <CodeMirrorFilePreview
                    blameError={
                      fileBlameQuery.isError
                        ? String(fileBlameQuery.error.message)
                        : null
                    }
                    blameLines={currentFileBlame}
                    blameLoading={Boolean(
                      selectedProjectPath &&
                        previewMode === "file" &&
                        fileBlameQuery.isFetching,
                    )}
                    draft={activeEditorDraft}
                    editorSessionKey={activePreviewTabId}
                    error={
                      fileContentQuery.isError
                        ? String(fileContentQuery.error.message)
                        : null
                    }
                    file={currentFileContent}
                    gitConflictStatus={selectedProjectFile?.conflict ?? null}
                    gitMarkers={editorGitMarkers}
                    loading={Boolean(
                      selectedProjectPath &&
                        fileContentQuery.isFetching &&
                        !currentFileContent,
                    )}
                    saveError={saveError}
                    saving={savingActiveFile}
                    selectedPath={selectedProjectPath}
                    target={previewTarget}
                    onChangeDraft={updateEditorDraft}
                    onDiscardConflict={discardConflictToDisk}
                    onSave={saveActivePreviewFile}
                    onSetConflictDraftContent={setConflictDraftContent}
                  />
              ) : gitAvailability === "loading" ? (
                <div className="diff-loading">
                  <Loader2 className="spin" size={18} />
                </div>
              ) : !hasGitRepository ? (
                <div className="empty-state">
                  <div className="empty-title">Git Diff Unavailable</div>
                  <div className="empty-copy">
                    This folder is not inside a Git repository.
                  </div>
                </div>
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
                  projectPath={activeProject?.activePath ?? null}
                  commit={activeCommit}
                />
              ) : (
                <div className="diff-loading">
                  <Loader2 className="spin" size={18} />
                </div>
              )}
            </section>
            {hasRightTopPanel ? (
              <>
                <ResizeHandle
                  axis="x"
                  className="rail-right-top-splitter"
                  label="Resize right rail slot"
                  onResize={handleResizeRightTop}
                  onResizeEnd={handleResizeRightTopEnd}
                />
                <WorkbenchRailSlotStack
                  activeItem={rightTopActiveItem}
                  activeProjectPath={activeProject?.activePath ?? null}
                  gitAvailability={gitAvailability}
                  dockedGitPanelOrder={dockedGitPanelOrder}
                  draggedGitPanel={draggedGitPanel}
                  gitPanelData={gitPanelData}
                  items={railLayout.right.top}
                  branchSize={panelSizes.branch}
                  commitDetailSize={panelSizes.commitInfo}
                  detailsSize={panelSizes.details}
                  projectTreeContent={projectTreeContent}
                  side="right"
                  slot="top"
                  onDragEnd={clearDockDrag}
                  onDragStart={startGitPanelDrag}
                  onDropPanel={moveGitPanel}
                  onReattachPanel={reattachGitPanel}
                  resizePanel={resizePanel}
                />
              </>
            ) : null}
            {hasBottomPanels ? (
              <>
                <ResizeHandle
                  axis="y"
                  className="rail-bottom-splitter"
                  label="Resize bottom rail slot"
                  onResize={handleResizeBottom}
                  onResizeEnd={handleResizeBottomEnd}
                />
                <section
                  className="rail-bottom-panels"
                  style={bottomPanelsStyle}
                >
                  {hasLeftBottomPanel ? (
                    <WorkbenchRailSlotStack
                      activeItem={leftBottomActiveItem}
                      activeProjectPath={activeProject?.activePath ?? null}
                      gitAvailability={gitAvailability}
                      dockedGitPanelOrder={dockedGitPanelOrder}
                      draggedGitPanel={draggedGitPanel}
                      gitPanelData={gitPanelData}
                      items={railLayout.left.bottom}
                      branchSize={panelSizes.branch}
                      commitDetailSize={panelSizes.commitInfo}
                      detailsSize={panelSizes.details}
                      projectTreeContent={projectTreeContent}
                      side="left"
                      slot="bottom"
                      onDragEnd={clearDockDrag}
                      onDragStart={startGitPanelDrag}
                      onDropPanel={moveGitPanel}
                      onReattachPanel={reattachGitPanel}
                      resizePanel={resizePanel}
                    />
                  ) : null}
                  {hasLeftBottomPanel && hasRightBottomPanel ? (
                    <ResizeHandle
                      axis="x"
                      className="rail-bottom-inner-splitter"
                      label="Resize bottom rail panels"
                      onResize={handleResizeBottomLeft}
                      onResizeEnd={handleResizeBottomLeftEnd}
                    />
                  ) : null}
                  {hasRightBottomPanel ? (
                    <WorkbenchRailSlotStack
                      activeItem={rightBottomActiveItem}
                      activeProjectPath={activeProject?.activePath ?? null}
                      gitAvailability={gitAvailability}
                      dockedGitPanelOrder={dockedGitPanelOrder}
                      draggedGitPanel={draggedGitPanel}
                      gitPanelData={gitPanelData}
                      items={railLayout.right.bottom}
                      branchSize={panelSizes.branch}
                      commitDetailSize={panelSizes.commitInfo}
                      detailsSize={panelSizes.details}
                      projectTreeContent={projectTreeContent}
                      side="right"
                      slot="bottom"
                      onDragEnd={clearDockDrag}
                      onDragStart={startGitPanelDrag}
                      onDropPanel={moveGitPanel}
                      onReattachPanel={reattachGitPanel}
                      resizePanel={resizePanel}
                    />
                  ) : null}
                </section>
              </>
            ) : null}
          </div>
        )}
      </section>
      <ProjectSideRail
        draggedRailItem={draggedRailItem}
        hasActiveProject={Boolean(activeProject)}
        isActiveItem={isRailItemActive("right")}
        railLayout={railLayout}
        onDropRailItem={(item, slot) => dropRailItem(item, "right", slot)}
        onSelectRailItem={handleSelectRailItem("right")}
        onStartRailItemDrag={startRailItemDrag}
      />
      {draggedRailItem ? (
        <RailDockOverlay
          draggedRailItem={draggedRailItem}
          onDropRailItem={dropRailItem}
        />
      ) : null}
      <CommandPanel
        activeIndex={commandSelectionIndex}
        error={
          fileSearchQuery.isError
            ? String(fileSearchQuery.error.message)
            : null
        }
        loading={fileSearchQuery.isFetching}
        mode={commandMode}
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

function findRailItemPlacement(
  railLayout: RailLayout,
  item: RailItemId,
): { side: RailSide; slot: RailSlot } | null {
  const placement = new Map<RailItemId, { side: RailSide; slot: RailSlot }>();
  for (const side of ["left", "right"] as const) {
    for (const slot of ["top", "bottom"] as const) {
      for (const id of railLayout[side][slot]) {
        placement.set(id, { side, slot });
      }
    }
  }
  return placement.get(item) ?? null;
}

function syncRailPanelSizeVars(
  element: HTMLDivElement | null,
  panelSizes: PanelSizes,
): void {
  if (!element) {
    return;
  }

  applyRailPanelSizeVar(element, "leftTop", panelSizes.leftTop);
  applyRailPanelSizeVar(element, "rightTop", panelSizes.rightTop);
  applyRailPanelSizeVar(element, "bottom", panelSizes.bottom);
  applyRailPanelSizeVar(element, "bottomLeft", panelSizes.bottomLeft);
}

function isPasteImportBlockedTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.matches("input, textarea, [contenteditable='true']") ||
      Boolean(target.closest("[data-command-panel], .cm-editor, .terminal-screen")))
  );
}

function applyRailPanelSizeVar(
  element: HTMLDivElement | null,
  key: RailPanelSizeKey,
  value: number,
): void {
  if (!element) {
    return;
  }

  element.style.setProperty(railPanelSizeVarName(key), `${value}px`);
}

function railPanelSizeVarName(key: RailPanelSizeKey): string {
  switch (key) {
    case "leftTop":
      return "--rail-left-top-width";
    case "rightTop":
      return "--rail-right-top-width";
    case "bottom":
      return "--rail-bottom-height";
    case "bottomLeft":
      return "--rail-bottom-left-width";
  }
}
