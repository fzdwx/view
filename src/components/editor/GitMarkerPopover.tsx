import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { RotateCcw, X } from "lucide-react";
import { gitMarkerLabel } from "../../lib/editorGitMarkers";
import type { EditorGitMarker } from "../../lib/editorTypes";

export function GitMarkerPopover({
  left,
  marker,
  top,
  onClose,
  onMoveHorizontal,
  onRevert,
}: {
  left: number;
  marker: EditorGitMarker;
  top: number;
  onClose(): void;
  onMoveHorizontal(delta: number): void;
  onRevert(): void;
}) {
  const previewLines = marker.diffLines.slice(0, 12);
  const hiddenLineCount = Math.max(0, marker.diffLines.length - previewLines.length);

  function startHorizontalDrag(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    let lastClientX = event.clientX;

    function handleMove(moveEvent: PointerEvent) {
      onMoveHorizontal(moveEvent.clientX - lastClientX);
      lastClientX = moveEvent.clientX;
    }

    function stopMove() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stopMove);
      window.removeEventListener("pointercancel", stopMove);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stopMove);
    window.addEventListener("pointercancel", stopMove);
  }

  return (
    <section
      className={`editor-git-popover ${marker.kind}`}
      style={{ left, top } as CSSProperties}
      aria-label="Change details"
    >
      <div className="editor-git-popover-head" onPointerDown={startHorizontalDrag}>
        <div>
          <span>{gitMarkerLabel(marker.kind)}</span>
          <small>
            line {marker.line}, +{marker.additions} -{marker.deletions}
          </small>
        </div>
        <button
          type="button"
          className="icon-button editor-git-popover-close"
          aria-label="Close change details"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
        >
          <X size={12} />
        </button>
      </div>
      <div className="editor-git-popover-diff" role="presentation">
        {previewLines.map((line, index) => (
          <pre
            key={`${index}-${line}`}
            className={
              line.startsWith("+")
                ? "added"
                : line.startsWith("-")
                  ? "deleted"
                  : "context"
            }
          >
            {line || " "}
          </pre>
        ))}
        {hiddenLineCount > 0 ? (
          <pre className="context">... {hiddenLineCount} more lines</pre>
        ) : null}
      </div>
      <div className="editor-git-popover-actions">
        <button type="button" className="ghost-button editor-git-revert" onClick={onRevert}>
          <RotateCcw size={13} />
          Rollback change
        </button>
      </div>
    </section>
  );
}
