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
import { ProjectTreeTitle } from "./components/ProjectTreeTitle";
import { PullChoiceDialog } from "./components/PullChoiceDialog";
import { ResizeHandle } from "./components/ResizeHandle";
import { FilePreview } from "./components/editor/FilePreview";
import {
  GitPanels,
  type GitPanelDataProps,
} from "./components/workbench/GitPanels";
import { ProjectFileTreePanel } from "./components/workbench/ProjectFileTreePanel";
import { ToolDockPanel } from "./components/workbench/ToolDockPanel";
import { WorkbenchDockOverlay } from "./components/workbench/WorkbenchDockOverlay";
import { WorkbenchToolPanelStack } from "./components/workbench/WorkbenchToolPanelStack";
import { gitToolPanels, toolPanels } from "./components/workbench/toolPanels";
import { useAppKeyboardShortcuts } from "./hooks/useAppKeyboardShortcuts";
import { useAppSettingsState } from "./hooks/useAppSettingsState";
import { useCommandPanel } from "./hooks/useCommandPanel";
import { useEditorDrafts } from "./hooks/useEditorDrafts";
import { useGitActions } from "./hooks/useGitActions";
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
  buildContentGridStyle,
} from "./lib/workbenchLayout";

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
    activityView,
    detachedGitPanels,
    draggedGitPanel,
    draggedToolPanel,
    draggingEditorPanel,
    draggingTreePanel,
    gitPanelOrder,
    panelSizes,
    projectInToolDock,
    toolDock,
    toolPanelCollapsed,
    treeDock,
    clearDockDrag,
    dockEditorPanel,
    dockProjectPanel,
    dockToolPanel,
    endToolPanelDrag,
    moveGitPanel,
    reattachGitPanel,
    resizePanel,
    selectToolPanelView,
    startEditorPanelDrag,
    startGitPanelDrag,
    startToolPanelDrag,
    startTreePanelDrag,
  } = useWorkbenchDock();

  const activeProject = projects.find(
    (project) => project.id === activeProjectId,
  );
  const activeProjectPath = activeProject?.activePath ?? null;
  const {
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
    activatePreviewTab,
    clearPreviewTabs,
    closePreviewTab,
    movePreviewTabPath,
    openPreviewTab,
    removePreviewTabsForPath,
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

  const contentGridStyle = buildContentGridStyle(
    treeDock,
    toolDock,
    !projectInToolDock,
    panelSizes.tree,
    toolPanelCollapsed ? 36 : panelSizes.log,
    panelSizes.sideDock,
  );
  const editorDock = treeDock === "left" ? "right" : "left";
  const dockedGitPanelOrder = gitPanelOrder.filter(
    (panel) => !detachedGitPanels.includes(panel),
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
  const handleTreeDragEnd = useCallback(() => {
    clearDockDrag();
  }, [clearDockDrag]);
  const handleTreeDragStart = useCallback(() => {
    startTreePanelDrag();
  }, [startTreePanelDrag]);
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
    setProjectSwitcherOpen((open) => !open);
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
    pullChoiceOpen,
    previewMode,
    shortcuts: appSettings.shortcuts,
    onCloseCommandPanel: closeCommandPanel,
    onClosePullChoice: closePullChoice,
    onOpenCommandPanel: openCommandPanel,
    onOpenPullChoice: openPullChoice,
    onSaveActiveFile: saveActivePreviewFile,
    onSelectToolPanelView: selectToolPanelView,
    onToggleProjectSwitcher: toggleProjectSwitcher,
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
    openPreviewTab("file", result.path, result.lineNumber);
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

  const gitPanelData: GitPanelDataProps = {
    activeCommit,
    commitFilter,
    commits,
    commitsLoading: commitsQuery.isLoading,
    detailHeight: panelSizes.commitInfo,
    filteredCommits,
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
      onDragEnd={handleTreeDragEnd}
      onDragStart={handleTreeDragStart}
      onCreateFile={handleProjectTreeCreateFile}
      onDeleteFile={handleProjectTreeDeleteFile}
      onRenameFile={handleProjectTreeRenameFile}
      onSelectPath={handleProjectTreeSelectPath}
    />
  );

  const gitPanelContent = (
    <GitPanels
      data={gitPanelData}
      dockedPanelOrder={dockedGitPanelOrder}
      draggedGitPanel={draggedGitPanel}
      panelSizes={panelSizes}
      toolDock={toolDock}
      onDragEnd={clearDockDrag}
      onDragStart={startGitPanelDrag}
      onDropPanel={moveGitPanel}
      onReattachPanel={reattachGitPanel}
      resizePanel={resizePanel}
    />
  );

  const toolPanelContent = (
    <WorkbenchToolPanelStack
      activeProjectPath={activeProject?.activePath ?? null}
      activityView={activityView}
      gitPanelContent={gitPanelContent}
      gitPanelData={gitPanelData}
      projectTreeContent={projectTreeContent}
      onDragEnd={clearDockDrag}
      onDragStart={startToolPanelDrag}
    />
  );
  const visibleToolPanels = [
    ...(projectInToolDock
      ? toolPanels.filter((panel) => panel.id === "project")
      : []),
    ...gitToolPanels.filter((panel) => detachedGitPanels.includes(panel.id)),
  ];

  return (
    <main className="app-shell" style={appShellStyle}>
      <ProjectRail
        activeProjectId={activeProjectId}
        activeProjectName={activeProject?.name ?? null}
        activityView={activityView}
        hasActiveProject={Boolean(activeProject)}
        projectSwitcherOpen={projectSwitcherOpen}
        projects={projects}
        onChooseRepository={chooseRepository}
        onCloseProjectSwitcher={closeProjectSwitcher}
        onRemoveProject={removeProject}
        onSelectProject={selectProject}
        onSelectToolPanelView={selectToolPanelView}
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
                onDragStart={startEditorPanelDrag}
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
