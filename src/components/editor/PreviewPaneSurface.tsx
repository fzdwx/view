import { Loader2 } from "lucide-react";
import { DiffPanel } from "../DiffPanel";
import { PreviewTabBar } from "../PreviewTabBar";
import { CodeMirrorFilePreview } from "./CodeMirrorFilePreview";
import { editorDraftKey } from "../../lib/editorDrafts";
import type { EditorDraft } from "../../lib/editorTypes";
import type { TreeFile } from "../../lib/api";
import type { GitAvailability } from "../workbench/GitPanels";
import {
  type PreviewPane,
  type PreviewPaneId,
  type PreviewSplitDirection,
} from "../../lib/previewPanes";
import type { PreviewTab } from "../../lib/previewTabs";
import { usePreviewPaneData } from "../../hooks/usePreviewPaneData";

interface PreviewPaneSurfaceProps {
  readonly activeCommit: string | null;
  readonly activePaneId: PreviewPaneId;
  readonly activeProjectPath: string | null;
  readonly dirtyTabIds: Set<string>;
  readonly editorDrafts: Record<string, EditorDraft>;
  readonly gitAvailability: GitAvailability;
  readonly hasGitRepository: boolean;
  readonly pane: PreviewPane;
  readonly projectFiles: readonly TreeFile[];
  readonly repositoryLoading: boolean;
  readonly repositoryReady: boolean;
  readonly saveError: string | null;
  readonly savingActiveFile: boolean;
  readonly onActivatePane: (paneId: PreviewPaneId) => void;
  readonly onChangeDraft: (content: string) => void;
  readonly onCloseAllTabs: (paneId: PreviewPaneId) => void;
  readonly onCloseOtherTabs: (paneId: PreviewPaneId, tabId: string) => void;
  readonly onCloseTab: (paneId: PreviewPaneId, tabId: string) => void;
  readonly onDiscardConflict: () => void;
  readonly onReorderTabs: (
    paneId: PreviewPaneId,
    fromId: string,
    toId: string,
  ) => void;
  readonly onSave: () => void;
  readonly onSelectTab: (paneId: PreviewPaneId, tab: PreviewTab) => void;
  readonly onSetConflictDraftContent: (content: string) => void;
  readonly onSplitTab: (
    paneId: PreviewPaneId,
    tabId: string,
    direction: PreviewSplitDirection,
  ) => void;
}

export function PreviewPaneSurface({
  activeCommit,
  activePaneId,
  activeProjectPath,
  dirtyTabIds,
  editorDrafts,
  gitAvailability,
  hasGitRepository,
  pane,
  projectFiles,
  repositoryLoading,
  repositoryReady,
  saveError,
  savingActiveFile,
  onActivatePane,
  onChangeDraft,
  onCloseAllTabs,
  onCloseOtherTabs,
  onCloseTab,
  onDiscardConflict,
  onReorderTabs,
  onSave,
  onSelectTab,
  onSetConflictDraftContent,
  onSplitTab,
}: PreviewPaneSurfaceProps) {
  const data = usePreviewPaneData({
    activeCommit,
    activeProjectPath,
    hasGitRepository,
    pane,
    projectFiles,
  });
  const isActive = pane.id === activePaneId;
  const draft =
    activeProjectPath && data.selectedProjectPath
      ? editorDrafts[editorDraftKey(activeProjectPath, data.selectedProjectPath)] ??
        null
      : null;

  return (
    <section
      className={isActive ? "editor-pane active" : "editor-pane"}
      onPointerDownCapture={() => onActivatePane(pane.id)}
      onFocusCapture={() => onActivatePane(pane.id)}
    >
      <PreviewTabBar
        activeTabId={pane.activeTabId}
        diffStats={data.diffStats}
        dirtyTabIds={dirtyTabIds}
        loading={paneLoading(repositoryLoading, data)}
        onCloseTab={(tabId) => onCloseTab(pane.id, tabId)}
        onCloseOtherTabs={(tabId) => onCloseOtherTabs(pane.id, tabId)}
        onCloseAllTabs={() => onCloseAllTabs(pane.id)}
        onReorderTabs={(fromId, toId) => onReorderTabs(pane.id, fromId, toId)}
        onSelectTab={(tab) => onSelectTab(pane.id, tab)}
        onSplitRight={(tab) => onSplitTab(pane.id, tab.id, "right")}
        onSplitDown={(tab) => onSplitTab(pane.id, tab.id, "down")}
        previewMode={pane.mode}
        projectPath={null}
        selectedPath={
          pane.mode === "diff"
            ? data.selectedChangePath
            : data.selectedProjectPath
        }
        tabs={pane.tabs}
        variant="pane"
      />
      <div className="editor-pane-body">
        {pane.mode === "file" ? (
          <CodeMirrorFilePreview
            blameError={
              data.fileBlameQuery.isError
                ? String(data.fileBlameQuery.error.message)
                : null
            }
            blameLines={data.currentFileBlame}
            blameLoading={Boolean(
              data.selectedProjectPath && data.fileBlameQuery.isFetching,
            )}
            draft={draft}
            editorSessionKey={`${pane.id}:${pane.activeTabId ?? pane.mode}`}
            error={
              data.fileContentQuery.isError
                ? String(data.fileContentQuery.error.message)
                : null
            }
            file={data.currentFileContent}
            gitConflictStatus={data.selectedProjectFile?.conflict ?? null}
            gitMarkers={data.editorGitMarkers}
            loading={Boolean(
              data.selectedProjectPath &&
                data.fileContentQuery.isFetching &&
                !data.currentFileContent,
            )}
            saveError={isActive ? saveError : null}
            saving={isActive && savingActiveFile}
            selectedPath={data.selectedProjectPath}
            target={pane.target}
            onChangeDraft={onChangeDraft}
            onDiscardConflict={onDiscardConflict}
            onSave={onSave}
            onSetConflictDraftContent={onSetConflictDraftContent}
          />
        ) : (
          <DiffPaneBody
            activeCommit={activeCommit}
            activeProjectPath={activeProjectPath}
            data={data}
            gitAvailability={gitAvailability}
            hasGitRepository={hasGitRepository}
            repositoryReady={repositoryReady}
          />
        )}
      </div>
    </section>
  );
}

function DiffPaneBody({
  activeCommit,
  activeProjectPath,
  data,
  gitAvailability,
  hasGitRepository,
  repositoryReady,
}: {
  readonly activeCommit: string | null;
  readonly activeProjectPath: string | null;
  readonly data: ReturnType<typeof usePreviewPaneData>;
  readonly gitAvailability: GitAvailability;
  readonly hasGitRepository: boolean;
  readonly repositoryReady: boolean;
}) {
  if (gitAvailability === "loading") {
    return <PaneLoading />;
  }
  if (!hasGitRepository) {
    return <PaneEmpty title="Git Diff Unavailable" copy="This folder is not inside a Git repository." />;
  }
  if (repositoryReady && !data.selectedChangePath) {
    return <PaneEmpty title="Select a changed file" copy="Choose a file from Changes to render its diff." />;
  }
  if (repositoryReady && data.fileDiffQuery.isFetching && !data.currentFileDiff) {
    return <PaneLoading />;
  }
  if (repositoryReady) {
    return (
      <DiffPanel
        error={
          data.parsedDiff.error ??
          (data.fileDiffQuery.isError
            ? String(data.fileDiffQuery.error.message)
            : null)
        }
        files={data.visibleDiffFiles}
        title={data.selectedChangePath ?? "Repository diff"}
        projectPath={activeProjectPath}
        commit={activeCommit}
      />
    );
  }
  return <PaneLoading />;
}

function PaneLoading() {
  return (
    <div className="diff-loading">
      <Loader2 className="spin" size={18} />
    </div>
  );
}

function PaneEmpty({
  title,
  copy,
}: {
  readonly title: string;
  readonly copy: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-title">{title}</div>
      <div className="empty-copy">{copy}</div>
    </div>
  );
}

function paneLoading(
  repositoryLoading: boolean,
  data: ReturnType<typeof usePreviewPaneData>,
): boolean {
  return (
    repositoryLoading ||
    data.fileContentQuery.isFetching ||
    data.fileDiffQuery.isFetching ||
    data.fileWorktreeDiffQuery.isFetching
  );
}
