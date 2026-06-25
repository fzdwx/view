import type { TreeFile } from "../../lib/api";
import type { EditorDraft, EditorGitMarker } from "../../lib/editorTypes";
import type {
  PreviewPane,
  PreviewPaneId,
  PreviewPaneLayout,
  PreviewPaneLayoutNode,
  PreviewSplitDirection,
} from "../../lib/previewPanes";
import type { PreviewTab } from "../../lib/previewTabs";
import type { GitAvailability } from "../workbench/GitPanels";
import { PreviewPaneSurface } from "./PreviewPaneSurface";

export interface EditorPaneGridProps {
  readonly activeCommit: string | null;
  readonly activePaneId: PreviewPaneId;
  readonly activeProjectPath: string | null;
  readonly dirtyTabIds: Set<string>;
  readonly editorDrafts: Record<string, EditorDraft>;
  readonly gitAvailability: GitAvailability;
  readonly hasGitRepository: boolean;
  readonly layout: PreviewPaneLayout;
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
  readonly onRunCommand: (
    command: string,
    label: string,
    cwd: string | null,
  ) => void;
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

export function EditorPaneGrid({
  layout,
  ...props
}: EditorPaneGridProps) {
  const panes = new Map(layout.panes.map((pane) => [pane.id, pane]));

  return (
    <section className="editor-pane-grid">
      <PreviewPaneLayoutNodeView node={layout.tree} panes={panes} props={props} />
    </section>
  );
}

interface PreviewPaneLayoutNodeViewProps {
  readonly node: PreviewPaneLayoutNode;
  readonly panes: ReadonlyMap<PreviewPaneId, PreviewPane>;
  readonly props: Omit<EditorPaneGridProps, "layout">;
}

function PreviewPaneLayoutNodeView({
  node,
  panes,
  props,
}: PreviewPaneLayoutNodeViewProps) {
  switch (node.kind) {
    case "pane": {
      const pane = panes.get(node.paneId);
      return pane ? <PreviewPaneSurface pane={pane} {...props} /> : null;
    }
    case "split":
      return (
        <div className={`editor-pane-split split-${node.direction}`}>
          {node.children.map((child) => (
            <div className="editor-pane-split-child" key={previewPaneNodeKey(child)}>
              <PreviewPaneLayoutNodeView node={child} panes={panes} props={props} />
            </div>
          ))}
        </div>
      );
    default:
      return assertNeverPreviewPaneNode(node);
  }
}

function previewPaneNodeKey(node: PreviewPaneLayoutNode): string {
  switch (node.kind) {
    case "pane":
      return node.paneId;
    case "split":
      return `${node.direction}:${node.children.map(previewPaneNodeKey).join("|")}`;
    default:
      return assertNeverPreviewPaneNode(node);
  }
}

function assertNeverPreviewPaneNode(_node: never): never {
  throw new Error("Unhandled preview pane layout node");
}
