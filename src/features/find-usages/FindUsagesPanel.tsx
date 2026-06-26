import {
  type KeyboardEvent,
  type MutableRefObject,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { Loader2, SearchCode, X } from "lucide-react";
import type { FileSearchResult } from "../../lib/api";
import { byteOffsetToUtf16 } from "../../lib/editorGitMarkers";
import { useFileIcon } from "../../lib/fileIcons";
import {
  fileNameFromPath,
  parentPathFromPath,
} from "../../lib/pathLabels";
import {
  findUsagesResultKey,
  groupFindUsagesResults,
} from "./findUsagesResults";
import type { FindUsagesPanelState } from "./useFindUsagesPanel";

export function FindUsagesPanel({
  state,
  onCancel,
  onClose,
  onOpenResult,
  onSelectIndex,
  onSelectNext,
  onSelectPrevious,
}: {
  readonly state: FindUsagesPanelState;
  readonly onCancel: () => void;
  readonly onClose: () => void;
  readonly onOpenResult: (result: FileSearchResult) => void;
  readonly onSelectIndex: (index: number) => void;
  readonly onSelectNext: () => void;
  readonly onSelectPrevious: () => void;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);
  const groups = useMemo(
    () => groupFindUsagesResults(state.results),
    [state.results],
  );
  const activeResult = state.results[state.activeIndex] ?? null;

  useEffect(() => {
    if (!state.open) {
      return;
    }
    panelRef.current?.focus({ preventScroll: true });
  }, [state.open, state.symbol]);

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [state.activeIndex]);

  if (!state.open) {
    return null;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (state.status === "loading") {
        onCancel();
      } else {
        onClose();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      onSelectNext();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      onSelectPrevious();
      return;
    }

    if (event.key === "Enter" && activeResult) {
      event.preventDefault();
      onOpenResult(activeResult);
    }
  }

  return (
    <section
      ref={panelRef}
      className="find-usages-panel"
      tabIndex={-1}
      aria-label={`Find usages for ${state.symbol}`}
      onKeyDown={handleKeyDown}
    >
      <header className="find-usages-header">
        <div className="find-usages-title">
          <SearchCode size={15} />
          <span>{state.symbol}</span>
          <small>{findUsagesStatusText(state)}</small>
        </div>
        <div className="find-usages-actions">
          {state.status === "loading" ? (
            <button type="button" className="ghost-button" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            className="icon-button"
            aria-label="Close find usages"
            title="Close find usages"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
      </header>
      <div className="find-usages-body">
        {state.status === "loading" ? (
          <div className="find-usages-empty">
            <Loader2 className="spin" size={15} />
            <span>Searching references...</span>
          </div>
        ) : state.status === "error" ? (
          <div className="find-usages-empty error">
            {state.error ?? "Reference search failed."}
          </div>
        ) : state.status === "cancelled" ? (
          <div className="find-usages-empty">Search cancelled.</div>
        ) : state.results.length === 0 ? (
          <div className="find-usages-empty">No references found.</div>
        ) : (
          groups.map((group) => (
            <FindUsagesFileGroup
              key={group.path}
              activeIndex={state.activeIndex}
              group={group}
              activeRowRef={activeRowRef}
              onOpenResult={onOpenResult}
              onSelectIndex={onSelectIndex}
            />
          ))
        )}
      </div>
    </section>
  );
}

function FindUsagesFileGroup({
  activeIndex,
  activeRowRef,
  group,
  onOpenResult,
  onSelectIndex,
}: {
  readonly activeIndex: number;
  readonly activeRowRef: MutableRefObject<HTMLButtonElement | null>;
  readonly group: ReturnType<typeof groupFindUsagesResults>[number];
  readonly onOpenResult: (result: FileSearchResult) => void;
  readonly onSelectIndex: (index: number) => void;
}) {
  const icon = useFileIcon(group.path);
  return (
    <section className="find-usages-file-group">
      <div className="find-usages-file-heading">
        <svg
          width={15}
          height={15}
          viewBox={icon.viewBox ?? "0 0 16 16"}
          className="find-usages-file-icon"
          style={{ color: icon.color }}
          aria-hidden="true"
        >
          <use href={`#${icon.name}`} />
        </svg>
        <span>{fileNameFromPath(group.path)}</span>
        <small>{parentPathFromPath(group.path)}</small>
      </div>
      <div className="find-usages-file-results">
        {group.results.map((result, offset) => {
          const resultIndex = group.startIndex + offset;
          const active = resultIndex === activeIndex;
          return (
            <button
              key={findUsagesResultKey(result, resultIndex)}
              ref={active ? activeRowRef : undefined}
              type="button"
              className={
                active
                  ? "find-usages-result active"
                  : "find-usages-result"
              }
              onClick={() => onOpenResult(result)}
              onMouseEnter={() => onSelectIndex(resultIndex)}
            >
              <span className="find-usages-result-line">
                {result.lineNumber ?? 1}
              </span>
              <span className="find-usages-result-preview">
                {resultPreviewLines(result).map((line) => (
                  <span
                    key={`${line.lineNumber}:${line.kind}`}
                    className={`find-usages-preview-line ${line.kind}`}
                  >
                    <span className="find-usages-preview-line-number">
                      {line.lineNumber}
                    </span>
                    <span className="find-usages-preview-text">
                      {line.segments.map((segment, index) => (
                        <span
                          key={`${index}-${segment.text}`}
                          className={segment.match ? "match" : undefined}
                        >
                          {segment.text || " "}
                        </span>
                      ))}
                    </span>
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

interface PreviewLine {
  readonly kind: "context" | "match";
  readonly lineNumber: number;
  readonly segments: readonly PreviewSegment[];
}

interface PreviewSegment {
  readonly text: string;
  readonly match: boolean;
}

function resultPreviewLines(result: FileSearchResult): readonly PreviewLine[] {
  const lineNumber = result.lineNumber;
  const lineText = result.lineText;
  if (!lineNumber || lineText == null) {
    return [];
  }

  const beforeStart = lineNumber - result.contextBefore.length;
  return [
    ...result.contextBefore.map((text, index) => ({
      kind: "context" as const,
      lineNumber: beforeStart + index,
      segments: [{ text, match: false }],
    })),
    {
      kind: "match" as const,
      lineNumber,
      segments: highlightedSegments(lineText, result.matchRanges),
    },
    ...result.contextAfter.map((text, index) => ({
      kind: "context" as const,
      lineNumber: lineNumber + index + 1,
      segments: [{ text, match: false }],
    })),
  ];
}

function highlightedSegments(
  text: string,
  byteRanges: readonly [number, number][],
): readonly PreviewSegment[] {
  if (byteRanges.length === 0) {
    return [{ text, match: false }];
  }

  const segments: PreviewSegment[] = [];
  let cursor = 0;
  for (const [byteStart, byteEnd] of byteRanges) {
    const start = byteOffsetToUtf16(text, byteStart);
    const end = byteOffsetToUtf16(text, byteEnd);
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), match: false });
    }
    if (end > start) {
      segments.push({ text: text.slice(start, end), match: true });
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), match: false });
  }
  return segments.length > 0 ? segments : [{ text, match: false }];
}

function findUsagesStatusText(state: FindUsagesPanelState): string {
  switch (state.status) {
    case "idle":
      return "Ready";
    case "loading":
      return state.currentFilePath
        ? `Searching from ${state.currentFilePath}`
        : "Searching references";
    case "ready":
      return `${state.results.length} reference${
        state.results.length === 1 ? "" : "s"
      }`;
    case "error":
      return "Search failed";
    case "cancelled":
      return "Cancelled";
  }
}
