import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
} from "react";
import { Check, Minus, RotateCcw, Trash2, X } from "lucide-react";
import { gitMarkerLabel } from "../../lib/editorGitMarkers";
import type { EditorGitMarker } from "../../lib/editorTypes";

export function GitMarkerPopover({
  left,
  marker,
  top,
  canRunGitChangeAction,
  onClose,
  onDiscard,
  onMoveHorizontal,
  onRevert,
  onStage,
  onUnstage,
}: {
  left: number;
  marker: EditorGitMarker;
  top: number;
  canRunGitChangeAction: boolean;
  onClose(): void;
  onDiscard(): void;
  onMoveHorizontal(delta: number): void;
  onRevert(): void;
  onStage(): void;
  onUnstage(): void;
}) {
  const popoverRef = useRef<HTMLDialogElement | null>(null);
  const previewLines = marker.diffLines.slice(0, 12);
  const hiddenLineCount = Math.max(0, marker.diffLines.length - previewLines.length);
  const changeScope = marker.lineCount === 1 ? "line" : "change";

  useEffect(() => {
    const popover = popoverRef.current;
    if (!popover) {
      return;
    }
    popover.focus({ preventScroll: true });
    popover.addEventListener("keydown", handleKeyDown);
    return () => popover.removeEventListener("keydown", handleKeyDown);
  });

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (!canRunGitChangeAction) {
      return;
    }

    const key = event.key.toLowerCase();
    if (marker.source === "worktree" && key === "s") {
      event.preventDefault();
      onStage();
      return;
    }
    if (marker.source === "worktree" && key === "d") {
      event.preventDefault();
      onDiscard();
      return;
    }
    if (marker.source === "worktree" && key === "r") {
      event.preventDefault();
      onRevert();
      return;
    }
    if (marker.source === "staged" && key === "u") {
      event.preventDefault();
      onUnstage();
    }
  }

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
    <dialog
      open
      ref={popoverRef}
      className={`editor-git-popover ${marker.kind}`}
      style={{ left, top } as CSSProperties}
      aria-label="Change details"
      tabIndex={-1}
    >
      <div className="editor-git-popover-head" onPointerDown={startHorizontalDrag}>
        <div>
          <span>{gitMarkerLabel(marker.kind)}</span>
          <small>
            {marker.source === "staged" ? "staged" : "worktree"} · line{" "}
            {marker.line}, +{marker.additions} -{marker.deletions}
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
        {marker.source === "worktree" ? (
          <>
            <button
              type="button"
              className="ghost-button editor-git-action"
              disabled={!canRunGitChangeAction}
              onClick={onStage}
            >
              <Check size={13} />
              Stage {changeScope}
              <kbd>S</kbd>
            </button>
            <button
              type="button"
              className="ghost-button editor-git-action danger"
              disabled={!canRunGitChangeAction}
              onClick={onDiscard}
            >
              <Trash2 size={13} />
              Discard {changeScope}
              <kbd>D</kbd>
            </button>
          </>
        ) : (
          <button
            type="button"
            className="ghost-button editor-git-action"
            disabled={!canRunGitChangeAction}
            onClick={onUnstage}
          >
            <Minus size={13} />
            Unstage {changeScope}
            <kbd>U</kbd>
          </button>
        )}
        {marker.source === "worktree" ? (
          <button type="button" className="ghost-button editor-git-revert" onClick={onRevert}>
            <RotateCcw size={13} />
            Draft rollback
            <kbd>R</kbd>
          </button>
        ) : null}
      </div>
    </dialog>
  );
}
