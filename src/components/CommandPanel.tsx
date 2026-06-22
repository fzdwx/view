import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { measureElement, useVirtualizer } from "@tanstack/react-virtual";
import { Loader2, Search } from "lucide-react";
import type { FileSearchResult } from "../lib/api";
import { useFileIcon } from "../lib/fileIcons";
import {
  fileNameFromPath,
  parentPathFromPath,
} from "../lib/pathLabels";
import { LoadingRows } from "./LoadingRows";

const FILE_RESULT_ESTIMATE = 52;
const CONTENT_RESULT_ESTIMATE = 108;

export function CommandPanel({
  activeIndex,
  error,
  loading,
  mode,
  open,
  projectName,
  query,
  results,
  onChangeQuery,
  onClose,
  onOpenResult,
  onSelectIndex,
}: {
  activeIndex: number;
  error: string | null;
  loading: boolean;
  mode: "files" | "content";
  open: boolean;
  projectName?: string;
  query: string;
  results: FileSearchResult[];
  onChangeQuery(query: string): void;
  onClose(): void;
  onOpenResult(result: FileSearchResult): void;
  onSelectIndex(index: number): void;
}) {
  const overlayRef = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultsScrollRef = useRef<HTMLDivElement | null>(null);
  const hasQuery = query.trim().length > 0;
  const lowerQuery = useMemo(() => query.trim().toLowerCase(), [query]);
  const estimateSize = mode === "content" ? CONTENT_RESULT_ESTIMATE : FILE_RESULT_ESTIMATE;
  const resultsVirtualizer = useVirtualizer<HTMLDivElement, HTMLButtonElement>({
    count: results.length,
    getScrollElement: () => resultsScrollRef.current,
    directDomUpdates: true,
    directDomUpdatesMode: "transform",
    estimateSize: () => estimateSize,
    getItemKey: (index) => `${results[index]?.path ?? index}:${results[index]?.lineNumber ?? "file"}`,
    measureElement,
    overscan: mode === "content" ? 10 : 14,
    useAnimationFrameWithResizeObserver: true,
  });

  useEffect(() => {
    if (!open || !results[activeIndex]) {
      return;
    }
    resultsVirtualizer.scrollToIndex(activeIndex, {
      align: "auto",
      behavior: "smooth",
    });
  }, [activeIndex, open, results, resultsVirtualizer]);

  useLayoutEffect(() => {
    resultsScrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [mode, query]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    const dialog = overlayRef.current;
    if (!dialog) {
      return;
    }
    if (dialog.open) {
      return;
    }
    dialog.showModal();
    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, []);

  if (!open) {
    return null;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      onSelectIndex(results.length === 0 ? 0 : (activeIndex + 1) % results.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      onSelectIndex(
        results.length === 0
          ? 0
          : (activeIndex - 1 + results.length) % results.length,
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const selected = results[activeIndex];
      if (selected) {
        onOpenResult(selected);
      }
    }
  }

  return (
    // <dialog> is inherently interactive; react-doctor doesn't recognize native dialog interactivity.
    // oxlint-disable-next-line react-doctor/no-noninteractive-element-interactions
    <dialog
      className="command-overlay"
      data-command-panel
      aria-label="Command panel"
      ref={overlayRef}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
    >
      <section className="command-panel">
        <div className="command-input-row">
          <Search size={17} />
         <input
           ref={inputRef}
           value={query}
            aria-label={mode === "content" ? "Search file contents" : "Search files by name or path"}
           onChange={(event) => onChangeQuery(event.target.value)}
           placeholder={
             mode === "content"
               ? "Search file contents…"
               : "Search files by name or path…"
           }
         />
          {loading ? <Loader2 className="spin" size={16} /> : null}
        </div>
        <div className="command-context">
          <span>
            {mode === "content" ? "Find in files" : "Find files"}
            {hasQuery && results.length > 0 ? ` · ${results.length} results` : ""}
            {mode === "content" ? " · " : " · "}
            {projectName ?? "No project"}
          </span>
          <kbd>Enter</kbd>
          <kbd>Esc</kbd>
        </div>
        <div ref={resultsScrollRef} className="command-results">
          {error ? (
            <div className="command-empty">
              <div className="empty-title">Search failed</div>
              <div className="empty-copy">{error}</div>
            </div>
          ) : !hasQuery ? (
            <div className="command-empty">
              <div className="empty-title">
                {mode === "content" ? "Type to search file contents" : "Type a file name or path"}
              </div>
              <div className="empty-copy">
                {mode === "content"
                  ? "Search scans file contents for matching text in the active worktree."
                  : "Fuzzy search scans tracked and untracked files in the active worktree."}
              </div>
            </div>
          ) : loading && results.length === 0 ? (
            <div className="command-loading">
              <LoadingRows />
            </div>
          ) : results.length === 0 && !loading ? (
            <div className="command-empty">
              <div className="empty-title">No results found</div>
              <div className="empty-copy">
                {mode === "content" ? "Try another search term." : "Try another filename or path segment."}
              </div>
            </div>
          ) : (
            <div ref={resultsVirtualizer.containerRef} className="command-results-spacer">
              {resultsVirtualizer.getVirtualItems().map((virtualItem) => {
                const result = results[virtualItem.index];
                return (
                  <CommandResultRow
                    key={virtualItem.key}
                    active={virtualItem.index === activeIndex}
                    lowerQuery={lowerQuery}
                    mode={mode}
                    result={result}
                    resultIndex={virtualItem.index}
                    refCallback={(node) => {
                      resultsVirtualizer.measureElement(node);
                    }}
                    onClick={() => onOpenResult(result)}
                    onMouseEnter={() => onSelectIndex(virtualItem.index)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </section>
    </dialog>
  );
}

function CommandResultRow({
  active,
  lowerQuery,
  mode,
  result,
  resultIndex,
  refCallback,
  onClick,
  onMouseEnter,
}: {
  active: boolean;
  lowerQuery: string;
  mode: "files" | "content";
  result: FileSearchResult;
  resultIndex: number;
  refCallback(node: HTMLButtonElement | null): void;
  onClick(): void;
  onMouseEnter(): void;
}) {
  const fileName = fileNameFromPath(result.path);
  const parentPath = parentPathFromPath(result.path) || "./";
  const hasLineMatch = Boolean(result.lineNumber && result.lineText);

  return (
    <button
      type="button"
      ref={refCallback}
      data-index={resultIndex}
      className={[
        "command-result",
        "command-result-virtual-row",
        active ? "active" : "",
        mode === "content" ? "command-result-content" : "command-result-file",
      ]
        .filter(Boolean)
        .join(" ")}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      <span className="command-result-icon">
        <ResultFileIcon path={result.path} />
      </span>
      <span className="command-result-main">
        {mode === "content" && hasLineMatch ? (
          <>
            <span className="command-result-path">
              {highlightMatch(fileName, lowerQuery)}{" "}
              <small className="command-result-path-dir">
                {parentPath}
              </small>
            </span>
            <div className="command-result-context">
              {result.contextBefore.map((line, i) => (
                <small
                  key={`before-${(result.lineNumber ?? 0) - result.contextBefore.length + i}`}
                  className="command-result-context-line"
                >
                  <span className="command-result-line-number">
                    {(result.lineNumber ?? 0) - result.contextBefore.length + i}
                  </span>
                  <span className="command-result-context-text">{line}</span>
                </small>
              ))}
              <small className="command-result-line command-result-line-matched">
                <span className="command-result-line-number">
                  {result.lineNumber}
                </span>
                <span className="command-result-line-text">
                  {highlightRanges(result.lineText ?? "", result.matchRanges)}
                </span>
              </small>
              {result.contextAfter.map((line, i) => (
                <small
                  key={`after-${(result.lineNumber ?? 0) + 1 + i}`}
                  className="command-result-context-line"
                >
                  <span className="command-result-line-number">
                    {(result.lineNumber ?? 0) + 1 + i}
                  </span>
                  <span className="command-result-context-text">{line}</span>
                </small>
              ))}
            </div>
          </>
        ) : (
          <>
            <span>
              {highlightMatch(fileName, lowerQuery)}
            </span>
            <small>
              {highlightMatch(parentPath, lowerQuery)}
            </small>
          </>
        )}
      </span>
    </button>
  );
}

function ResultFileIcon({ path }: { path: string }) {
  const icon = useFileIcon(path);
  return (
    <svg
      width={16}
      height={16}
      viewBox={icon.viewBox ?? "0 0 16 16"}
      className="command-result-file-icon"
      style={{ color: icon.color }}
      aria-hidden="true"
    >
      <use href={`#${icon.name}`} />
    </svg>
  );
}

/**
 * Highlight matched characters from a fuzzy query within text.
 * Returns an array of plain and highlighted segments.
 */
function highlightMatch(text: string, query: string): ReactNode {
  if (!query) return text;

  const lowerText = text.toLowerCase();
  const indices: number[] = [];
  let qi = 0;

  for (let ti = 0; ti < lowerText.length && qi < query.length; ti++) {
    if (lowerText[ti] === query[qi]) {
      indices.push(ti);
      qi++;
    }
  }

  if (indices.length === 0) return text;

  const segments: ReactNode[] = [];
  let lastEnd = 0;

  for (const matchOffset of indices) {
    if (matchOffset > lastEnd) {
      segments.push(text.slice(lastEnd, matchOffset));
    }
    segments.push(
      <mark key={matchOffset} className="command-match">
        {text[matchOffset]}
      </mark>,
    );
    lastEnd = matchOffset + 1;
  }

  if (lastEnd < text.length) {
    segments.push(text.slice(lastEnd));
  }

  return segments;
}

/**
 * Highlight matched ranges using exact byte offsets from the Rust grep.
 * matchRanges are [start, end) byte offsets within lineText.
 */
function highlightRanges(text: string, ranges: [number, number][]): ReactNode {
  if (ranges.length === 0) return text;

  const segments: ReactNode[] = [];
  let lastEnd = 0;

  for (const [start, end] of ranges) {
    if (start > lastEnd) {
      segments.push(text.slice(lastEnd, start));
    }
    segments.push(
      <mark key={start} className="command-match">
        {text.slice(start, end)}
      </mark>,
    );
    lastEnd = Math.max(lastEnd, end);
  }

  if (lastEnd < text.length) {
    segments.push(text.slice(lastEnd));
  }

  return segments;
}
