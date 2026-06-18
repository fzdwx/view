import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";
import { Loader2, Search } from "lucide-react";
import type { FileSearchResult } from "../lib/api";
import { useFileIcon } from "../lib/fileIcons";
import {
  fileNameFromPath,
  parentPathFromPath,
} from "../lib/pathLabels";

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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const hasQuery = query.trim().length > 0;
  const lowerQuery = useMemo(() => query.trim().toLowerCase(), [query]);

  useEffect(() => {
    const el = resultRefs.current[activeIndex];
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  if (!open) {
    return null;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
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
    <div className="command-overlay" data-command-panel onMouseDown={onClose}>
      <section
        className="command-panel"
        aria-label="Command panel"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="command-input-row">
          <Search size={17} />
          <input
            ref={inputRef}
            value={query}
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
        <div className="command-results">
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
          ) : results.length === 0 && !loading ? (
            <div className="command-empty">
              <div className="empty-title">No results found</div>
              <div className="empty-copy">
                {mode === "content" ? "Try another search term." : "Try another filename or path segment."}
              </div>
            </div>
          ) : (
            results.map((result, index) => {
              const fileName = fileNameFromPath(result.path);
              const parentPath = parentPathFromPath(result.path) || "./";
              const hasLineMatch = Boolean(result.lineNumber && result.lineText);

              return (
                <button
                  key={`${result.path}:${result.lineNumber ?? "file"}`}
                  ref={(el) => {
                    resultRefs.current[index] = el;
                  }}
                  className={[
                    "command-result",
                    index === activeIndex ? "active" : "",
                    mode === "content" ? "command-result-content" : "command-result-file",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onMouseEnter={() => onSelectIndex(index)}
                  onClick={() => onOpenResult(result)}
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
                              key={`before-${i}`}
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
                              key={`after-${i}`}
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
            })
          )}
        </div>
      </section>
    </div>
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
  let key = 0;

  for (const idx of indices) {
    if (idx > lastEnd) {
      segments.push(text.slice(lastEnd, idx));
    }
    segments.push(
      <mark key={key++} className="command-match">
        {text[idx]}
      </mark>,
    );
    lastEnd = idx + 1;
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
  let key = 0;

  for (const [start, end] of ranges) {
    if (start > lastEnd) {
      segments.push(text.slice(lastEnd, start));
    }
    segments.push(
      <mark key={key++} className="command-match">
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
