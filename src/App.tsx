import { useCallback, useEffect, useMemo, useState } from "react";
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
import { FilePreview } from "./components/editor/FilePreview";
import {
  type GitPanelDataProps,
} from "./components/workbench/GitPanels";
import { ProjectFileTreePanel } from "./components/workbench/ProjectFileTreePanel";
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
import { useProjectSelectionActions } from "./hooks/useProjectSelectionActions";
import { useRepositoryRemotePolling } from "./hooks/useRepositoryRemotePolling";
import {
  useRepositoryPreviewData,
  useRepositoryProjectData,
} from "./hooks/useRepositoryWorkspaceData";
import { useSelectedPathGuard } from "./hooks/useSelectedPathGuard";
import { useWorkbenchDock } from "./hooks/useWorkbenchDock";
import { type FileSearchResult } from "./lib/api";
import {
  type SavedProject,
  loadSavedProjects,
  projectNameFromPath,
  saveProjects,
} from "./lib/projects";
import { projectRootFromPayload } from "./lib/repositoryPayload";
import {
  buildRailBottomPanelsStyle,
  buildRailWorkbenchGridStyle,
} from "./lib/workbenchLayout";
import type {
  RailItemId,
  RailLayout,
  RailSlot,
  RailSide,
  ToolPanelId,
} from "./lib/workbenchTypes";

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
  const [selectedProjectPath, setSelectedProjectPath] = useState<string | null>(null);
  const [selectedChangePath, setSelectedChangePath] = useState<string | null>(null);
  const [commitFilter, setCommitFilter] = useState("");
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
  useEffect(() => {
    saveProjects(projects);
  }, [projects]);

  const {
    commandResults,
    commits,
    commitsQuery,
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
    selectedProjectStatus,
  } = useRepositoryProjectData({
    activeBranchRef,
    activeCommit,
    activeProjectPath,
    commandMode,
    commandOpen,
    commitFilter,
    debouncedCommandQuery,
    selectedProjectPath,
  });
  const handleFileSaved = useCallback(
    async (projectPath: string, filePath: string) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["file-content", projectPath, filePath],
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
    removePreviewTabsForPath,
    selectedProjectPath,
    setSelectedProjectPath,
  });
  const gitWriteActions = useGitWriteActions({
    activeProject,
    editorDrafts,
    gitWriteGuard,
    repositoryPayload: payload,
  });
  const {
    currentFileDiff,
    diffStats,
    editorGitMarkers,
    fileDiffQuery,
    fileWorktreeDiffQuery,
    parsedDiff,
    visibleDiffFiles,
  } = useRepositoryPreviewData({
    activeCommit,
    activeProjectPath,
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
    createFileFromTree,
    deleteFileFromTree,
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
    refetchCommits: commitsQuery.refetch,
    refetchFileWorktreeDiff: fileWorktreeDiffQuery.refetch,
    refetchProjectFiles: projectFilesQuery.refetch,
    refetchRepository: repositoryQuery.refetch,
    refreshProjectFileState,
    setActiveBranchRef,
    setActiveCommit,
    setSelectedChangePath,
    showDiffSelection,
  });

  useEffect(() => {
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
  }, [activeProject?.id, repositoryQuery.data]);

  const leftTopActiveItem = railActiveItems.left.top;
  const leftBottomActiveItem = railActiveItems.left.bottom;
  const rightTopActiveItem = railActiveItems.right.top;
  const rightBottomActiveItem = railActiveItems.right.bottom;
  const hasLeftTopPanel = leftTopActiveItem !== null;
  const hasLeftBottomPanel = leftBottomActiveItem !== null;
  const hasRightTopPanel = rightTopActiveItem !== null;
  const hasRightBottomPanel = rightBottomActiveItem !== null;
  const hasBottomPanels = hasLeftBottomPanel || hasRightBottomPanel;
  const contentGridStyle = buildRailWorkbenchGridStyle(
    hasLeftTopPanel,
    hasRightTopPanel,
    hasBottomPanels,
    panelSizes.leftTop,
    panelSizes.rightTop,
    panelSizes.bottom,
  );
  const bottomPanelsStyle = hasBottomPanels
    ? buildRailBottomPanelsStyle(
        hasLeftBottomPanel,
        hasRightBottomPanel,
        panelSizes.bottomLeft,
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
    [activeProject?.activePath],
  );
  const handleProjectTreeCreateFile = useCallback((parentPath: string | null) => {
    void createFileFromTree(parentPath);
  }, [createFileFromTree]);
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
    items: payload?.files,
    placeholder: repositoryQuery.isPlaceholderData,
    selectedPath: selectedChangePath,
    onClear: clearSelectedChangePath,
  });
  useRepositoryRemotePolling({
    activeProjectPath,
    refetchCommits: commitsQuery.refetch,
    refetchProjectFiles: projectFilesQuery.refetch,
    refetchRepository: repositoryQuery.refetch,
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
      setSelectedChangePath(null);
      showDiffSelection();
    },
    [showDiffSelection],
  );

  const selectCommit = useCallback(
    (hash: string) => {
      setActiveCommit(hash);
      setSelectedChangePath(null);
      showDiffSelection();
    },
    [showDiffSelection],
  );

  const selectWorkingTree = useCallback(() => {
    setActiveCommit(null);
    setSelectedChangePath(null);
    showDiffSelection();
  }, [showDiffSelection]);
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

  const gitPanelData: GitPanelDataProps = {
    activeCommit,
    commitFilter,
    commits,
    commitsLoading: commitsQuery.isLoading,
    detailHeight: panelSizes.commitInfo,
    filteredCommits,
    gitFileActions: treeGitFileActions,
    gitWriteActions,
    payload,
    selectedBranch,
    selectedBranchRef,
    selectedChangePath,
    selectedCommit,
    onBranchAction: performBranchAction,
    onChangeCommitFilter: setCommitFilter,
    onOpenDiffPath: (path) => openPreviewTab("diff", path),
    onResizeCommitInfo: (delta) =>
      resizePanel("commitInfo", -delta, 110, 360),
    onSelectBranch: selectBranchRef,
    onSelectCommit: selectCommit,
    onSelectWorkingTree: selectWorkingTree,
  };

  const projectTreeContent = (
    <ProjectFileTreePanel
      files={projectFilesQuery.data}
      selectedPath={selectedProjectPath}
      title={projectTreeTitle}
      gitFileActions={treeGitFileActions}
      onCreateFile={handleProjectTreeCreateFile}
      onDeleteFile={handleProjectTreeDeleteFile}
      onRenameFile={handleProjectTreeRenameFile}
      onSelectPath={handleProjectTreeSelectPath}
    />
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

      <section className="workspace">
        {!activeProject ? (
          <div className="welcome-surface">
            <div className="welcome-drag-strip" data-tauri-drag-region />
            <div className="welcome-icon">
              <FolderOpen size={26} />
            </div>
            <h1>Open a Git repository</h1>
            <p>
              View keeps multiple repositories in the rail and lets each project
              switch between its worktrees.
            </p>
            <button className="primary-action compact" onClick={chooseRepository}>
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
            <div className="error-title">Repository could not be loaded</div>
            <pre>{String(repositoryQuery.error.message)}</pre>
            <div className="welcome-controls">
              <WindowControls />
            </div>
          </div>
        ) : (
          <div
            className="content-grid"
            style={contentGridStyle}
          >
            {hasLeftTopPanel ? (
              <>
                <WorkbenchRailSlotStack
                  activeItem={leftTopActiveItem}
                  activeProjectPath={activeProject?.activePath ?? null}
                  dockedGitPanelOrder={dockedGitPanelOrder}
                  draggedGitPanel={draggedGitPanel}
                  gitPanelData={gitPanelData}
                  items={railLayout.left.top}
                  panelSizes={panelSizes}
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
                  onResize={(delta) => resizePanel("leftTop", delta, 220, 560)}
                />
              </>
            ) : null}

            <section className="diff-panel rail-editor-panel">
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
                  saving={savingActiveFile}
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
                  onResize={(delta) => resizePanel("rightTop", -delta, 220, 560)}
                />
                <WorkbenchRailSlotStack
                  activeItem={rightTopActiveItem}
                  activeProjectPath={activeProject?.activePath ?? null}
                  dockedGitPanelOrder={dockedGitPanelOrder}
                  draggedGitPanel={draggedGitPanel}
                  gitPanelData={gitPanelData}
                  items={railLayout.right.top}
                  panelSizes={panelSizes}
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
                  onResize={(delta) => resizePanel("bottom", -delta, 180, 560)}
                />
                <section
                  className="rail-bottom-panels"
                  style={bottomPanelsStyle}
                >
                  {hasLeftBottomPanel ? (
                    <WorkbenchRailSlotStack
                      activeItem={leftBottomActiveItem}
                      activeProjectPath={activeProject?.activePath ?? null}
                      dockedGitPanelOrder={dockedGitPanelOrder}
                      draggedGitPanel={draggedGitPanel}
                      gitPanelData={gitPanelData}
                      items={railLayout.left.bottom}
                      panelSizes={panelSizes}
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
                      onResize={(delta) =>
                        resizePanel("bottomLeft", delta, 260, 1400)
                      }
                    />
                  ) : null}
                  {hasRightBottomPanel ? (
                    <WorkbenchRailSlotStack
                      activeItem={rightBottomActiveItem}
                      activeProjectPath={activeProject?.activePath ?? null}
                      dockedGitPanelOrder={dockedGitPanelOrder}
                      draggedGitPanel={draggedGitPanel}
                      gitPanelData={gitPanelData}
                      items={railLayout.right.bottom}
                      panelSizes={panelSizes}
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
  for (const side of ["left", "right"] as const) {
    for (const slot of ["top", "bottom"] as const) {
      if (railLayout[side][slot].includes(item)) {
        return { side, slot };
      }
    }
  }

  return null;
}
