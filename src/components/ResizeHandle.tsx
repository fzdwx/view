import type {
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  dispatchPanelResizeEnd,
  dispatchPanelResizeStart,
} from "../lib/panelResizeInteraction";
import { isPerfLogEnabled, logPerf } from "../lib/performanceLog";
import { resizeSessionPerfFields } from "../lib/resizeHandlePerf";

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
    let resizeFrame: number | null = null;
    let resizeFrameStartedAt: number | null = null;
    let pendingDelta = 0;
    let totalDelta = 0;
    const collectPerf = isPerfLogEnabled();
    const resizeStats = {
      commitMs: 0,
      frames: 0,
      maxFlushMs: 0,
      totalFlushMs: 0,
      maxRafWaitMs: 0,
    };
    document.body.classList.add(
      axis === "x" ? "is-resizing-x" : "is-resizing-y",
    );
    dispatchPanelResizeStart();

    function flushPendingDelta() {
      if (pendingDelta === 0) {
        return;
      }
      const delta = pendingDelta;
      pendingDelta = 0;
      const startedAt = collectPerf ? performance.now() : 0;
      onResize(delta);
      if (collectPerf) {
        const flushMs = performance.now() - startedAt;
        resizeStats.frames += 1;
        resizeStats.maxFlushMs = Math.max(resizeStats.maxFlushMs, flushMs);
        resizeStats.totalFlushMs += flushMs;
        if (resizeFrameStartedAt != null) {
          resizeStats.maxRafWaitMs = Math.max(
            resizeStats.maxRafWaitMs,
            startedAt - resizeFrameStartedAt,
          );
        }
      }
      resizeFrameStartedAt = null;
    }

    function scheduleResizeFlush() {
      if (resizeFrame !== null) {
        return;
      }

      resizeFrameStartedAt = performance.now();
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

      pendingDelta += delta;
      totalDelta += delta;
      scheduleResizeFlush();
    }

    function finishResize() {
      if (totalDelta !== 0) {
        const commitStartedAt = collectPerf ? performance.now() : 0;
        onResizeEnd?.(totalDelta);
        if (collectPerf) {
          resizeStats.commitMs = performance.now() - commitStartedAt;
        }
      }
      document.body.classList.remove("is-resizing-x", "is-resizing-y");
      dispatchPanelResizeEnd();
      if (collectPerf && resizeStats.frames > 0) {
        const sessionMaxMs = Math.max(
          resizeStats.maxFlushMs,
          resizeStats.commitMs,
        );
        logPerf(
          "resize:session",
          sessionMaxMs,
          resizeSessionPerfFields({
            axis,
            className,
            label,
            commitMs: resizeStats.commitMs,
            frames: resizeStats.frames,
            totalDelta,
            totalFlushMs: resizeStats.totalFlushMs,
            maxRafWaitMs: resizeStats.maxRafWaitMs,
          }),
          { slowThresholdMs: 8 },
        );
      }
    }

    function stopResize() {
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = null;
      }
      flushPendingDelta();
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      finishResize();
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
