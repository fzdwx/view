import type {
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  dispatchPanelResizeEnd,
  dispatchPanelResizeStart,
} from "../lib/panelResizeInteraction";

export function ResizeHandle({
  axis,
  className,
  label,
  onResize,
  onResizeEnd,
}: {
  axis: "x" | "y";
  className: string;
  label: string;
  onResize(delta: number): void;
  onResizeEnd?(totalDelta: number): void;
}) {
  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();

    let lastPosition = axis === "x" ? event.clientX : event.clientY;
    let pendingDelta = 0;
    let resizeFrame: number | null = null;
    let totalDelta = 0;
    document.body.classList.add(
      axis === "x" ? "is-resizing-x" : "is-resizing-y",
    );
    dispatchPanelResizeStart();

    function flushPendingDelta() {
      if (pendingDelta === 0) {
        return;
      }

      onResize(pendingDelta);
      pendingDelta = 0;
    }

    function scheduleResizeFlush() {
      if (resizeFrame !== null) {
        return;
      }

      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        flushPendingDelta();
      });
    }

    function handleMove(moveEvent: PointerEvent) {
      const nextPosition =
        axis === "x" ? moveEvent.clientX : moveEvent.clientY;
      const delta = nextPosition - lastPosition;
      lastPosition = nextPosition;
      if (delta === 0) {
        return;
      }

      totalDelta += delta;
      pendingDelta += delta;
      scheduleResizeFlush();
    }

    function stopResize() {
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = null;
      }
      flushPendingDelta();
      if (totalDelta !== 0) {
        onResizeEnd?.(totalDelta);
      }
      document.body.classList.remove("is-resizing-x", "is-resizing-y");
      dispatchPanelResizeEnd();
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 30 : 10;
    if (axis === "x" && event.key === "ArrowLeft") {
      event.preventDefault();
      onResize(-step);
      onResizeEnd?.(-step);
    } else if (axis === "x" && event.key === "ArrowRight") {
      event.preventDefault();
      onResize(step);
      onResizeEnd?.(step);
    } else if (axis === "y" && event.key === "ArrowUp") {
      event.preventDefault();
      onResize(-step);
      onResizeEnd?.(-step);
    } else if (axis === "y" && event.key === "ArrowDown") {
      event.preventDefault();
      onResize(step);
      onResizeEnd?.(step);
    }
  }

  return (
    // Focusable, draggable separator. <hr> (the rule's suggestion) can't carry
    // the interactive tabIndex+keyboard handler without re-tripping a11y rules.
    // oxlint-disable-next-line react-doctor/prefer-tag-over-role
    <div role="separator" aria-label={label} aria-orientation={axis === "x" ? "vertical" : "horizontal"} tabIndex={0} className={`resize-handle ${axis === "x" ? "resize-handle-x" : "resize-handle-y"} ${className}`} onPointerDown={startResize} onKeyDown={handleKeyDown} />
  );
}
