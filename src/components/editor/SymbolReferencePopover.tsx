import type { CSSProperties } from "react";
import { Loader2, X } from "lucide-react";
import type { FileSearchResult } from "../../lib/api";
import type { SymbolReferenceHoverState } from "./useSymbolReferenceHover";

export function SymbolReferencePopover({
  popover,
  onClose,
  onOpenReference,
}: {
  readonly popover: SymbolReferenceHoverState;
  readonly onClose: () => void;
  readonly onOpenReference: (result: FileSearchResult) => void;
}) {
  return (
    <section
      className="editor-symbol-popover"
      style={{ left: popover.left, top: popover.top } as CSSProperties}
      aria-label={`References for ${popover.symbol}`}
    >
      <header className="editor-symbol-popover-head">
        <div>
          <span>{popover.symbol}</span>
          <small>{symbolPopoverStatus(popover)}</small>
        </div>
        <button
          type="button"
          className="icon-button editor-symbol-popover-close"
          aria-label="Close references"
          onClick={onClose}
        >
          <X size={12} />
        </button>
      </header>
      <div className="editor-symbol-popover-body">
        {popover.status === "loading" ? (
          <div className="editor-symbol-popover-empty">
            <Loader2 className="spin" size={14} />
            Searching call sites
          </div>
        ) : popover.status === "error" ? (
          <div className="editor-symbol-popover-empty">{popover.error}</div>
        ) : popover.results.length === 0 ? (
          <div className="editor-symbol-popover-empty">No call sites found</div>
        ) : (
          popover.results.map((result, index) => {
            const previewLines = symbolReferencePreviewLines(result);

            return (
              <button
                key={`${result.path}:${result.lineNumber ?? "file"}:${index}`}
                type="button"
                className="editor-symbol-result"
                onClick={() => onOpenReference(result)}
              >
                <span className="editor-symbol-result-path">
                  {result.path}
                  {result.lineNumber ? `:${result.lineNumber}` : ""}
                </span>
                {previewLines.length > 0 ? (
                  <span className="editor-symbol-result-preview">
                    {previewLines.map((line) => (
                      <span
                        key={`${line.lineNumber}:${line.kind}`}
                        className={`editor-symbol-result-code-line ${line.kind}`}
                      >
                        <span className="editor-symbol-result-line-number">
                          {line.lineNumber}
                        </span>
                        <span className="editor-symbol-result-code-text">
                          {line.text || " "}
                        </span>
                      </span>
                    ))}
                  </span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

type SymbolReferencePreviewLine = {
  readonly kind: "context" | "match";
  readonly lineNumber: number;
  readonly text: string;
};

function symbolReferencePreviewLines(
  result: FileSearchResult,
): SymbolReferencePreviewLine[] {
  const lineNumber = result.lineNumber;
  if (!lineNumber || !result.lineText) {
    return [];
  }

  const beforeStart = lineNumber - result.contextBefore.length;
  return [
    ...result.contextBefore.map((text, index) => ({
      kind: "context" as const,
      lineNumber: beforeStart + index,
      text,
    })),
    {
      kind: "match" as const,
      lineNumber,
      text: result.lineText,
    },
    ...result.contextAfter.map((text, index) => ({
      kind: "context" as const,
      lineNumber: lineNumber + index + 1,
      text,
    })),
  ];
}

function symbolPopoverStatus(popover: SymbolReferenceHoverState): string {
  switch (popover.status) {
    case "loading":
      return "Finding references";
    case "error":
      return "Reference search failed";
    case "ready":
      return `${popover.results.length} call ${
        popover.results.length === 1 ? "site" : "sites"
      }`;
  }
}
