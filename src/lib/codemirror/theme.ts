import { EditorView } from "@uiw/react-codemirror";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import pierreDarkTheme from "@pierre/theme/pierre-dark";

/**
 * Resolves a TextMate scope from the pierre-dark theme to its foreground color.
 * Used to drive CodeMirror syntax highlighting from the same token palette as
 * the shiki diff view and the tree, so editor and diff readouts stay in sync.
 */
const pierreTokenColorByScope = new Map<string, string | null>();
for (const tokenColor of pierreDarkTheme.tokenColors) {
  const scopeValue = tokenColor.scope;
  const scopes = Array.isArray(scopeValue)
    ? scopeValue
    : scopeValue
      ? [scopeValue]
      : [];
  const foreground = tokenColor.settings.foreground ?? null;
  for (const scope of scopes) {
    if (!pierreTokenColorByScope.has(scope)) {
      pierreTokenColorByScope.set(scope, foreground);
    }
  }
}

function pierreTokenColor(scope: string): string | null {
  return pierreTokenColorByScope.get(scope) ?? null;
}

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
 * Syntax highlight colors. Mapped from the pierre-dark theme token palette
 * (the same source the shiki diff view, tree, and merge editor use) so the
 * editor shares one palette with the rest of the workbench instead of
 * approximating it with hardcoded colors.
 */
const pierreCodeMirrorHighlightStyle = HighlightStyle.define([
  { tag: t.comment, color: pierreTokenColor("comment") ?? "var(--muted)", fontStyle: "italic" },
  { tag: t.keyword, color: pierreTokenColor("keyword") ?? "#ff678d" },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: pierreTokenColor("constant.language") ?? "#68cdf2" },
  { tag: [t.number, t.literal], color: pierreTokenColor("constant.numeric") ?? "#68cdf2" },
  { tag: t.string, color: pierreTokenColor("string") ?? "#5ecc71" },
  { tag: [t.variableName, t.propertyName], color: pierreTokenColor("variable") ?? "#ffa359" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: pierreTokenColor("entity.name.function") ?? "#9d6afb" },
  { tag: t.typeName, color: pierreTokenColor("entity.name.type") ?? "#d568ea" },
  { tag: t.tagName, color: pierreTokenColor("entity.name.tag") ?? "#ff855e" },
  { tag: t.attributeName, color: pierreTokenColor("entity.other.attribute-name") ?? "#60d199" },
  { tag: t.operator, color: pierreTokenColor("keyword.operator") ?? "#636363" },
  { tag: [t.meta, t.documentMeta], color: pierreTokenColor("comment") ?? "var(--muted)" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
]);

export const pierreCodeMirrorHighlighting = syntaxHighlighting(
  pierreCodeMirrorHighlightStyle,
);
