import { EditorView } from "@uiw/react-codemirror";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * Pierre dark theme for CodeMirror, mapped to the app's existing CSS tokens
 * (see styles.css :root) so the editor shares the same surface/ink/line
 * palette as the rest of the workbench instead of introducing a new one.
 */
export const pierreCodeMirrorTheme = EditorView.theme({
  "&": {
    color: "var(--ink)",
    backgroundColor: "var(--surface-0)",
    fontFamily: "var(--mono)",
    fontSize: "var(--editor-font-size, 12px)",
    height: "100%",
  },
  ".cm-content": {
    caretColor: "var(--ink)",
    fontFamily: "var(--mono)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--surface-0)",
    color: "var(--faint)",
    border: "none",
  },
  ".cm-activeLine": { backgroundColor: "var(--surface-1)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--surface-1)" },
  ".cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "rgb(64 108 255 / 0.34)",
    borderRadius: "2px",
  },
  "&.cm-focused .cm-selectionLayer .cm-selectionBackground": {
    backgroundColor: "rgb(64 108 255 / 0.46)",
  },
  ".cm-content ::selection": {
    backgroundColor: "rgb(64 108 255 / 0.76)",
    color: "#ffffff",
  },
  ".cm-searchMatch": {
    borderRadius: "2px",
    backgroundColor: "rgb(64 108 255 / 0.28)",
    boxShadow: "inset 0 0 0 1px rgb(64 108 255 / 0.48)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "rgb(64 108 255 / 0.42)",
    boxShadow: "inset 0 0 0 1px rgb(145 170 255 / 0.95)",
  },
  ".cm-cursor": { borderLeftColor: "var(--ink)" },
  ".cm-matchingBracket": {
    backgroundColor: "var(--surface-2)",
    outline: "1px solid var(--line-strong)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--mono)",
    lineHeight: "var(--editor-line-height, 1.5)",
  },
  ".cm-lineNumbers .cm-gutterElement": { color: "var(--faint)" },
});

/**
 * Syntax highlight colors. These approximate the pierre-dark shiki palette used
 * by the diff view so editor and diff readouts feel consistent.
 */
export const pierreCodeMirrorHighlightStyle = HighlightStyle.define([
  { tag: t.comment, color: "var(--muted)", fontStyle: "italic" },
  { tag: t.keyword, color: "#c586c0" },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: "#569cd6" },
  { tag: [t.number, t.literal], color: "#b5cea8" },
  { tag: t.string, color: "#ce9178" },
  { tag: [t.variableName, t.propertyName], color: "#9cdcfe" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#dcdcaa" },
  { tag: t.typeName, color: "#4ec9b0" },
  { tag: t.tagName, color: "#569cd6" },
  { tag: t.attributeName, color: "#9cdcfe" },
  { tag: [t.meta, t.documentMeta], color: "var(--muted)" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
]);

export const pierreCodeMirrorHighlighting = syntaxHighlighting(
  pierreCodeMirrorHighlightStyle,
);
