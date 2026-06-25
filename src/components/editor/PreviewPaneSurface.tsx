import { useCallback } from "react";
import { PreviewTabBar } from "../PreviewTabBar";
import { CodeMirrorFilePreview } from "./CodeMirrorFilePreview";
import { editorDraftKey } from "../../lib/editorDrafts";
import type { EditorDraft, EditorGitMarker } from "../../lib/editorTypes";
import type { FileRunTarget, TreeFile } from "../../lib/api";
import type { GitAvailability } from "../workbench/GitPanels";
import {
  type PreviewPane,
  type PreviewPaneId,
  type PreviewSplitDirection,
} from "../../lib/previewPanes";
import { isTerminalPreviewTab, type PreviewTab } from "../../lib/previewTabs";
import { usePreviewPaneData } from "../../hooks/usePreviewPaneData";
import { useFileRunTargets } from "../../hooks/useFileRunTargets";
import { PreviewPaneDiffBody } from "./PreviewPaneDiffBody";
import { paneLoading } from "./previewPaneLoading";
import { TerminalEditorPane } from "./TerminalEditorPane";
import {
  previewPaneSurfaceClassName,
  usePreviewPaneSplitDrop,
} from "./usePreviewPaneSplitDrop";
import { usePreviewPaneTerminalDrop } from "./usePreviewPaneTerminalDrop";

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
  readonly canRunGitChangeAction: boolean;
  readonly onActivatePane: (paneId: PreviewPaneId) => void;
  readonly onChangeDraftForFile: (
    projectPath: string,
    filePath: string,
    baseContent: string,
    content: string,
  ) => void;
  readonly onCloseAllTabs: (paneId: PreviewPaneId) => void;
  readonly onCloseOtherTabs: (paneId: PreviewPaneId, tabId: string) => void;
  readonly onCloseTab: (paneId: PreviewPaneId, tabId: string) => void;
  readonly onDiscardConflict: () => void;
  readonly onDiscardGitChange: (
    filePath: string,
    marker: EditorGitMarker,
  ) => Promise<boolean>;
  readonly onReorderTabs: (
    paneId: PreviewPaneId,
    fromId: string,
    toId: string,
  ) => void;
  readonly onOpenTerminalTab: (
    paneId: PreviewPaneId,
    projectPath: string,
    terminalTabId: string,
    title: string,
  ) => void;
  readonly onRunCommand: (target: FileRunTarget) => void;
  readonly onSave: () => void;
  readonly onSelectTab: (paneId: PreviewPaneId, tab: PreviewTab) => void;
  readonly onStageGitChange: (
    filePath: string,
    marker: EditorGitMarker,
  ) => Promise<boolean>;
  readonly onSetConflictDraftContent: (content: string) => void;
  readonly onSplitTab: (
    paneId: PreviewPaneId,
    tabId: string,
    direction: PreviewSplitDirection,
  ) => void;
  readonly onUnstageGitChange: (
    filePath: string,
    marker: EditorGitMarker,
  ) => Promise<boolean>;
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
  canRunGitChangeAction,
  onActivatePane,
  onChangeDraftForFile,
  onCloseAllTabs,
  onCloseOtherTabs,
  onCloseTab,
  onDiscardConflict,
  onDiscardGitChange,
  onOpenTerminalTab,
  onReorderTabs,
  onRunCommand,
  onSave,
  onSelectTab,
  onStageGitChange,
  onSetConflictDraftContent,
  onSplitTab,
  onUnstageGitChange,
}: PreviewPaneSurfaceProps) {
  const data = usePreviewPaneData({
    activeCommit,
    activeProjectPath,
    hasGitRepository,
    pane,
    projectFiles,
  });
  const isActive = pane.id === activePaneId;
  const activeTab = pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? null;
  const splitDrop = usePreviewPaneSplitDrop({ pane, onSplitTab });
  const terminalDrop = usePreviewPaneTerminalDrop({
    paneId: pane.id,
    onOpenTerminalTab,
  });
  const draft =
    activeProjectPath && data.selectedProjectPath
      ? editorDrafts[editorDraftKey(activeProjectPath, data.selectedProjectPath)] ??
        null
      : null;
  const effectiveDraft =
    draft &&
    data.currentFileContent &&
    !draft.conflict &&
    draft.content === draft.baseContent &&
    draft.baseContent !== data.currentFileContent.content
      ? null
      : draft;
  const editorContent =
    effectiveDraft?.content ?? data.currentFileContent?.content ?? "";
  const runTargets = useFileRunTargets({
    content: editorContent,
    enabled: Boolean(
      data.currentFileContent &&
        !data.currentFileContent.binary &&
        !data.currentFileContent.tooLarge,
    ),
    filePath: data.selectedProjectPath,
    projectPath: activeProjectPath,
  });
  const handleChangeDraft = useCallback(
    (content: string) => {
      if (activeProjectPath && data.selectedProjectPath && data.currentFileContent) {
        onChangeDraftForFile(
          activeProjectPath,
          data.selectedProjectPath,
          data.currentFileContent.content,
          content,
        );
      }
    },
    [
      activeProjectPath,
      data.currentFileContent,
      data.selectedProjectPath,
      onChangeDraftForFile,
    ],
  );

  const handleSetConflictDraftContent = useCallback(
    (content: string) => {
      if (activeProjectPath && data.selectedProjectPath && data.currentFileContent) {
        onChangeDraftForFile(
          activeProjectPath,
          data.selectedProjectPath,
          data.currentFileContent.content,
          content,
        );
        return;
      }

      onSetConflictDraftContent(content);
    },
    [
      activeProjectPath,
      data.currentFileContent,
      data.selectedProjectPath,
      onChangeDraftForFile,
      onSetConflictDraftContent,
    ],
  );

  return (
    <section
      className={[
        previewPaneSurfaceClassName(isActive, splitDrop.intent),
        terminalDrop.dragging ? "drop-terminal-tab" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onPointerDownCapture={() => onActivatePane(pane.id)}
      onFocusCapture={() => onActivatePane(pane.id)}
      onDragLeaveCapture={(event) => {
        terminalDrop.onDragLeaveCapture(event);
        splitDrop.dragHandlers.onDragLeaveCapture(event);
      }}
      onDragOverCapture={(event) => {
        terminalDrop.onDragOverCapture(event);
        if (!event.isPropagationStopped()) {
          splitDrop.dragHandlers.onDragOverCapture(event);
        }
      }}
      onDropCapture={(event) => {
        terminalDrop.onDropCapture(event);
        if (!event.isPropagationStopped()) {
          splitDrop.dragHandlers.onDropCapture(event);
        }
      }}
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
            : pane.mode === "file"
              ? data.selectedProjectPath
              : null
        }
        tabs={pane.tabs}
        variant="pane"
      />
      <div className="editor-pane-body">
        {isTerminalPreviewTab(activeTab) ? (
          <TerminalEditorPane active={isActive} tab={activeTab} />
        ) : pane.mode === "file" ? (
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
            draft={effectiveDraft}
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
            runTargets={runTargets}
            saveError={isActive ? saveError : null}
            saving={isActive && savingActiveFile}
            selectedPath={data.selectedProjectPath}
            target={pane.target}
            canRunGitChangeAction={canRunGitChangeAction}
            onChangeDraft={handleChangeDraft}
            onDiscardConflict={onDiscardConflict}
            onDiscardGitChange={onDiscardGitChange}
            onRunCommand={onRunCommand}
            onSave={onSave}
            onStageGitChange={onStageGitChange}
            onSetConflictDraftContent={handleSetConflictDraftContent}
            onUnstageGitChange={onUnstageGitChange}
          />
        ) : (
          <PreviewPaneDiffBody
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
