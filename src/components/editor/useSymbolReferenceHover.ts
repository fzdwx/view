import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { EditorView as CodeMirrorEditorView } from "@uiw/react-codemirror";
import {
  type FileSearchResult,
  searchSymbolReferences,
} from "../../lib/api";
import { moduleSpecifierAtLine } from "../../lib/editorModuleSpecifier";
import { symbolTokenAtLine } from "../../lib/editorSymbolToken";
import { clamp } from "../../lib/numeric";

const SYMBOL_HOVER_DELAY_MS = 180;
const SYMBOL_HOVER_RESULT_LIMIT = 8;
const SYMBOL_POPOVER_WIDTH = 520;
const SYMBOL_POPOVER_HEIGHT = 360;

export type SymbolReferenceHoverState =
  | SymbolReferenceHoverLoading
  | SymbolReferenceHoverReady
  | SymbolReferenceHoverError;

interface SymbolReferenceHoverBase {
  readonly symbol: string;
  readonly left: number;
  readonly top: number;
}

interface SymbolReferenceHoverLoading extends SymbolReferenceHoverBase {
  readonly status: "loading";
  readonly results: readonly FileSearchResult[];
}

interface SymbolReferenceHoverReady extends SymbolReferenceHoverBase {
  readonly status: "ready";
  readonly results: readonly FileSearchResult[];
}

interface SymbolReferenceHoverError extends SymbolReferenceHoverBase {
  readonly status: "error";
  readonly results: readonly FileSearchResult[];
  readonly error: string;
}

export function useSymbolReferenceHover({
  activeProjectPath,
  editorView,
  editorViewportHeight,
  editorViewportWidth,
  filePath,
  stageRef,
}: {
  readonly activeProjectPath: string | null;
  readonly editorView: CodeMirrorEditorView | null;
  readonly editorViewportHeight: number;
  readonly editorViewportWidth: number;
  readonly filePath: string | null;
  readonly stageRef: RefObject<HTMLDivElement | null>;
}) {
  const [popover, setPopover] = useState<SymbolReferenceHoverState | null>(null);
  const hoverKeyRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const closePopover = useCallback(() => {
    clearTimer();
    requestIdRef.current += 1;
    hoverKeyRef.current = null;
    editorView?.dom.classList.remove("cm-symbol-hover-active");
    setPopover(null);
  }, [clearTimer, editorView]);

  useEffect(() => {
    const stage = stageRef.current;
    const view = editorView;
    const projectPath = activeProjectPath;
    const currentFilePath = filePath;
    if (!stage || !view || !projectPath || !currentFilePath) {
      closePopover();
      return;
    }
    const stageElement: HTMLDivElement = stage;
    const viewInstance: CodeMirrorEditorView = view;

    function clearHover() {
      clearTimer();
      requestIdRef.current += 1;
      hoverKeyRef.current = null;
      viewInstance.dom.classList.remove("cm-symbol-hover-active");
      setPopover(null);
    }

    stageElement.addEventListener("mouseleave", clearHover);

    return () => {
      clearTimer();
      viewInstance.dom.classList.remove("cm-symbol-hover-active");
      stageElement.removeEventListener("mouseleave", clearHover);
    };
  }, [
    activeProjectPath,
    clearTimer,
    closePopover,
    editorView,
    editorViewportHeight,
    editorViewportWidth,
    filePath,
    stageRef,
  ]);

  const openAtPosition = useCallback(
    (position: number) => {
      const stage = stageRef.current;
      const view = editorView;
      const projectPath = activeProjectPath;
      const currentFilePath = filePath;
      if (!stage || !view || !projectPath || !currentFilePath) {
        closePopover();
        return false;
      }

      const line = view.state.doc.lineAt(position);
      if (moduleSpecifierAtLine(line.text, line.from, position)) {
        closePopover();
        return false;
      }

      const token = symbolTokenAtLine(line.text, line.from, position);
      if (!token) {
        closePopover();
        return false;
      }

      const coords = view.coordsAtPos(token.from) ?? view.coordsAtPos(position);
      if (!coords) {
        closePopover();
        return false;
      }

      const stageRect = stage.getBoundingClientRect();
      const left = clamp(
        coords.left - stageRect.left,
        8,
        Math.max(8, editorViewportWidth - SYMBOL_POPOVER_WIDTH - 8),
      );
      const top = clamp(
        coords.bottom - stageRect.top + 5,
        8,
        Math.max(8, editorViewportHeight - SYMBOL_POPOVER_HEIGHT - 8),
      );
      const hoverKey = `${currentFilePath}:${token.from}:${token.to}:${token.symbol}`;
      if (hoverKeyRef.current === hoverKey) {
        return true;
      }

      clearTimer();
      hoverKeyRef.current = hoverKey;
      view.dom.classList.add("cm-symbol-hover-active");
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setPopover({
        symbol: token.symbol,
        left,
        top,
        status: "loading",
        results: [],
      });

      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        searchSymbolReferences(
          projectPath,
          token.symbol,
          SYMBOL_HOVER_RESULT_LIMIT,
          currentFilePath,
        )
          .then((results) => {
            if (requestIdRef.current !== requestId) {
              return;
            }
            setPopover({
              symbol: token.symbol,
              left,
              top,
              status: "ready",
              results,
            });
          })
          .catch((error: unknown) => {
            if (requestIdRef.current !== requestId) {
              return;
            }
            setPopover({
              symbol: token.symbol,
              left,
              top,
              status: "error",
              results: [],
              error: error instanceof Error ? error.message : String(error),
            });
          });
      }, SYMBOL_HOVER_DELAY_MS);

      return true;
    },
    [
      activeProjectPath,
      clearTimer,
      closePopover,
      editorView,
      editorViewportHeight,
      editorViewportWidth,
      filePath,
      stageRef,
    ],
  );

  return { popover, closePopover, openAtPosition };
}
