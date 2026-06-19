import { useMemo } from "react";
import type {
  EditorState,
  EditorView,
  Extension,
  ViewUpdate,
} from "@uiw/react-codemirror";
import CodeMirror from "@uiw/react-codemirror";
import {
  pierreCodeMirrorTheme,
  pierreCodeMirrorHighlighting,
} from "../../lib/codemirror/theme";
import { languageForPath } from "../../lib/codemirror/languages";

export interface CodeMirrorViewProps {
  readonly path: string;
  readonly value: string;
  readonly readOnly?: boolean;
  readonly editable?: boolean;
  readonly onChange?: (value: string) => void;
  readonly onCreateEditor?: (view: EditorView, state: EditorState) => void;
  readonly onUpdate?: (viewUpdate: ViewUpdate) => void;
  readonly extensions?: readonly Extension[];
  readonly basicSetup?: boolean | Record<string, unknown>;
  readonly className?: string;
}

/**
 * Shared CodeMirror 6 surface for file previews and conflict editors.
 */
export function CodeMirrorView({
  path,
  value,
  readOnly = true,
  editable = false,
  onChange,
  onCreateEditor,
  onUpdate,
  extensions: extraExtensions,
  basicSetup,
  className,
}: CodeMirrorViewProps) {
  const language = useMemo(() => languageForPath(path), [path]);
  const extensions = useMemo(() => {
    const base: Extension[] = [
      pierreCodeMirrorTheme,
      pierreCodeMirrorHighlighting,
    ];
    if (language) {
      base.push(language);
    }
    if (extraExtensions) {
      base.push(...extraExtensions);
    }
    return base;
  }, [language, extraExtensions]);

  return (
    <CodeMirror
      className={className}
      value={value}
      readOnly={readOnly}
      editable={editable}
      theme="none"
      basicSetup={
        basicSetup ?? {
          drawSelection: false,
          lineNumbers: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          foldGutter: false,
          bracketMatching: true,
          closeBrackets: editable,
          autocompletion: false,
          searchKeymap: true,
        }
      }
      extensions={extensions}
      onChange={onChange}
      onCreateEditor={onCreateEditor}
      onUpdate={onUpdate}
      style={{ height: "100%" }}
    />
  );
}
