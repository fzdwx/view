import { AlertTriangle, Loader2, Save } from "lucide-react";
import { UnresolvedFile } from "@pierre/diffs/react";
import type { FileContent } from "../../lib/api";
import {
  conflictToMarkerFile,
  hasGitConflictMarkers,
  gitConflictToMarkerFile,
  type GitConflictResolutionStrategy,
} from "../../lib/editorDrafts";
import type { EditorDraft } from "../../lib/editorTypes";
import { CodeMirrorView } from "./CodeMirrorView";

type EditorDraftHandlers = {
  readonly onChangeDraft: (content: string) => void;
};

type SaveState = {
  readonly saveError: string | null;
  readonly saving: boolean;
  readonly onSave: () => void;
};

export function GitConflictEditor({
  content,
  file,
  saveError,
  saving,
  canMarkResolved,
  onChangeDraft,
  onAcceptResolution,
  onMarkResolved,
  onSave,
}: {
  content: string;
  file: FileContent;
  canMarkResolved: boolean;
  onAcceptResolution(strategy: GitConflictResolutionStrategy): void;
  onMarkResolved(): void;
} & EditorDraftHandlers & SaveState) {
  const hasMarkers = hasGitConflictMarkers(content);
  return (
    <section className="merge-page" aria-label={`Resolve ${file.path}`}>
      <div className="editor-toolbar conflict-toolbar">
        <div className="editor-status conflict">
          <AlertTriangle size={14} />
          <span>Merge conflict</span>
          <small>{file.path}</small>
        </div>
        <div className="editor-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => onAcceptResolution("ours")}
          >
            Accept ours
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => onAcceptResolution("theirs")}
          >
            Accept theirs
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => onAcceptResolution("both")}
          >
            Accept both
          </button>
          <button type="button" className="primary-action editor-save" disabled={saving} onClick={onSave}>
           {saving ? <Loader2 className="spin" size={14} /> : <Save size={14} />}
           Save resolved
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={saving || hasMarkers || !canMarkResolved}
            onClick={onMarkResolved}
          >
            Mark resolved
          </button>
        </div>
      </div>
      <div className="merge-diff-frame">
        <UnresolvedFile
          file={gitConflictToMarkerFile(file.path, content)}
          className="diff-view merge-conflict-view"
          options={mergeConflictOptions}
        />
      </div>
      <MergeTextarea
        content={content}
        filePath={file.path}
        onChangeDraft={onChangeDraft}
      />
      {saveError ? <div className="editor-error">{saveError}</div> : null}
    </section>
  );
}

export function DiskConflictEditor({
  conflict,
  content,
  file,
  saveError,
  saving,
  onChangeDraft,
  onDiscardConflict,
  onSave,
  onSetConflictDraftContent,
}: {
  conflict: NonNullable<EditorDraft["conflict"]>;
  content: string;
  file: FileContent;
  onDiscardConflict(): void;
  onSetConflictDraftContent(content: string): void;
} & EditorDraftHandlers & SaveState) {
  return (
    <section className="merge-page" aria-label={`Merge ${file.path}`}>
      <div className="editor-toolbar conflict-toolbar">
        <div className="editor-status conflict">
          <AlertTriangle size={14} />
          <span>File changed on disk</span>
        </div>
        <div className="editor-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => onSetConflictDraftContent(conflict.currentContent)}
          >
            Use disk
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => onSetConflictDraftContent(conflict.proposedContent)}
          >
            Use mine
          </button>
          <button type="button" className="ghost-button" onClick={onDiscardConflict}>
           Reload disk
          </button>
          <button type="button" className="primary-action editor-save" disabled={saving} onClick={onSave}>
           {saving ? <Loader2 className="spin" size={14} /> : <Save size={14} />}
           Save merge
          </button>
        </div>
      </div>
      <div className="merge-diff-frame">
        <UnresolvedFile
          file={conflictToMarkerFile(conflict)}
          className="diff-view merge-conflict-view"
          options={mergeConflictOptions}
        />
      </div>
      <MergeTextarea
        content={content}
        filePath={file.path}
        onChangeDraft={onChangeDraft}
      />
      {saveError ? <div className="editor-error">{saveError}</div> : null}
    </section>
  );
}

function MergeTextarea({
  content,
  onChangeDraft,
  filePath,
}: {
  readonly content: string;
  readonly filePath: string;
} & EditorDraftHandlers) {
  return (
    <CodeMirrorView
      className="merge-editor code-mirror-file-editor"
      path={filePath}
      value={content}
      readOnly={false}
      editable
      onChange={onChangeDraft}
    />
  );
}

const mergeConflictOptions = {
  mergeConflictActionsType: "none",
  overflow: "scroll",
  tokenizeMaxLineLength: 400,
  theme: {
    light: "pierre-light",
    dark: "pierre-dark",
  },
  themeType: "dark",
} as const;
