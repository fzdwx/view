import type { Extension } from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";

/**
 * Select a CodeMirror language extension for a repository-relative file path.
 * Returns null when no bundled language matches, so callers can render a
 * plain editor without syntax highlighting instead of guessing.
 */
export function languageForPath(path: string): Extension | null {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return javascript();
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return javascript({ typescript: true, jsx: ext === "tsx" });
    case "py":
    case "pyi":
      return python();
    case "rs":
      return rust();
    case "md":
    case "markdown":
      return markdown();
    case "json":
      return json();
    case "css":
    case "scss":
    case "sass":
      return css();
    case "html":
    case "htm":
    case "xml":
    case "svg":
      return html();
    default:
      return null;
  }
}
