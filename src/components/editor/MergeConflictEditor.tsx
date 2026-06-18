import type { KeyboardEvent, RefObject, UIEvent } from "react";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import { UnresolvedFile } from "@pierre/diffs/react";
import type { FileContent } from "../../lib/api";
import {
  conflictToMarkerFile,
  gitConflictToMarkerFile,
} from "../../lib/editorDrafts";
import type { EditorDraft } from "../../lib/editorTypes";

type EditorTextareaHandlers = {
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly onChangeDraft: (content: string) => void;
  readonly onEditorKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly onEditorScroll: (event: UIEvent<HTMLTextAreaElement>) => void;
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
  textareaRef,
  onChangeDraft,
  onEditorKeyDown,
  onEditorScroll,
  onSave,
}: {
  content: string;
  file: FileContent;
} & EditorTextareaHandlers & SaveState) {
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
          options={mergeConflictOptions}
        />
      </div>
      <MergeTextarea
        content={content}
        textareaRef={textareaRef}
        onChangeDraft={onChangeDraft}
        onEditorKeyDown={onEditorKeyDown}
        onEditorScroll={onEditorScroll}
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
  textareaRef,
  onChangeDraft,
  onDiscardConflict,
  onEditorKeyDown,
  onEditorScroll,
  onSave,
  onSetConflictDraftContent,
}: {
  conflict: NonNullable<EditorDraft["conflict"]>;
  content: string;
  file: FileContent;
  onDiscardConflict(): void;
  onSetConflictDraftContent(content: string): void;
} & EditorTextareaHandlers & SaveState) {
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
          options={mergeConflictOptions}
        />
      </div>
      <MergeTextarea
        content={content}
        textareaRef={textareaRef}
        onChangeDraft={onChangeDraft}
        onEditorKeyDown={onEditorKeyDown}
        onEditorScroll={onEditorScroll}
      />
      {saveError ? <div className="editor-error">{saveError}</div> : null}
    </section>
  );
}

function MergeTextarea({
  content,
  textareaRef,
  onChangeDraft,
  onEditorKeyDown,
  onEditorScroll,
}: {
  readonly content: string;
} & EditorTextareaHandlers) {
  return (
    <textarea
      ref={textareaRef}
      className="file-editor merge-editor"
      spellCheck={false}
      defaultValue={content}
      onKeyDown={onEditorKeyDown}
      onScroll={onEditorScroll}
      onChange={(event) => onChangeDraft(event.target.value)}
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
