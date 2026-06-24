export type ResizeMode = "live" | "deferred";

export interface ResizeDragControllerOptions {
  readonly mode: ResizeMode;
  readonly onGuideDelta?: (delta: number) => void;
  readonly onResize: (delta: number) => void;
  readonly onResizeEnd?: (totalDelta: number) => void;
}

export interface ResizeDragController {
  readonly addDelta: (delta: number) => void;
  readonly flush: () => void;
  readonly finish: () => void;
}

export function createResizeDragController({
  mode,
  onGuideDelta,
  onResize,
  onResizeEnd,
}: ResizeDragControllerOptions): ResizeDragController {
  let pendingDelta = 0;
  let totalDelta = 0;

  return {
    addDelta(delta: number) {
      if (delta === 0) {
        return;
      }
      pendingDelta += delta;
      totalDelta += delta;
    },
    flush() {
      if (pendingDelta === 0) {
        return;
      }

      if (mode === "deferred") {
        onGuideDelta?.(totalDelta);
      } else {
        onResize(pendingDelta);
      }
      pendingDelta = 0;
    },
    finish() {
      this.flush();
      if (totalDelta !== 0) {
        onResizeEnd?.(totalDelta);
      }
    },
  };
}
