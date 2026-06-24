import type {
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  dispatchPanelResizeEnd,
  dispatchPanelResizeStart,
} from "../lib/panelResizeInteraction";
import {
  createResizeDragController,
  type ResizeMode,
} from "../lib/resizeDragController";

export function ResizeHandle({
  axis,
  className,
  label,
  onResize,
  onResizeEnd,
  resizeMode = "live",
}: {
  axis: "x" | "y";
  className: string;
  label: string;
  onResize(delta: number): void;
  onResizeEnd?(totalDelta: number): void;
  resizeMode?: ResizeMode;
}) {
  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();

    const guide =
      resizeMode === "deferred"
        ? createResizeGuide(event.currentTarget, axis)
        : null;
    let lastPosition = axis === "x" ? event.clientX : event.clientY;
    let resizeFrame: number | null = null;
    const dragController = createResizeDragController({
      mode: resizeMode,
      onGuideDelta: (delta) => guide?.setDelta(delta),
      onResize,
      onResizeEnd,
    });
    document.body.classList.add(
      axis === "x" ? "is-resizing-x" : "is-resizing-y",
    );
    dispatchPanelResizeStart();

    function flushPendingDelta() {
      dragController.flush();
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

      dragController.addDelta(delta);
      scheduleResizeFlush();
    }

    function stopResize() {
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = null;
      }
      dragController.finish();
      guide?.destroy();
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

function createResizeGuide(
  source: HTMLElement,
  axis: "x" | "y",
): {
  readonly setDelta: (delta: number) => void;
  readonly destroy: () => void;
} {
  const rect = source.getBoundingClientRect();
  const guide = document.createElement("div");
  guide.className = `resize-handle-guide resize-handle-guide-${axis}`;
  guide.style.left = `${rect.left}px`;
  guide.style.top = `${rect.top}px`;
  guide.style.width = `${rect.width}px`;
  guide.style.height = `${rect.height}px`;
  document.body.appendChild(guide);

  return {
    setDelta(delta: number) {
      guide.style.transform =
        axis === "x"
          ? `translate3d(${delta}px, 0, 0)`
          : `translate3d(0, ${delta}px, 0)`;
    },
    destroy() {
      guide.remove();
    },
  };
}
