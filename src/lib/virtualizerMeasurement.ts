import {
  observeElementRect as observeTanStackElementRect,
  type Rect,
  type Virtualizer,
} from "@tanstack/react-virtual";
import {
  isPanelResizeInProgress,
  panelResizeEndEvent,
} from "./panelResizeInteraction";

export function measureElementByEstimate<
  TScrollElement extends Element | Window,
  TItemElement extends Element,
>(
  element: TItemElement,
  _entry: ResizeObserverEntry | undefined,
  instance: Virtualizer<TScrollElement, TItemElement>,
): number {
  const indexAttribute = instance.options.indexAttribute ?? "data-index";
  const index = Number.parseInt(element.getAttribute(indexAttribute) ?? "", 10);
  return instance.options.estimateSize(
    Number.isFinite(index) && index >= 0 ? index : 0,
  );
}

export function observeElementRectDuringPanelResize<
  TScrollElement extends Element,
  TItemElement extends Element,
>(
  instance: Virtualizer<TScrollElement, TItemElement>,
  callback: (rect: Rect) => void,
): void | (() => void) {
  let pendingRect: Rect | null = null;
  let animationFrame: number | null = null;

  const cancelScheduledFlush = () => {
    if (animationFrame != null) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
  };

  const flushPendingRect = () => {
    animationFrame = null;
    const rect = pendingRect;
    pendingRect = null;
    if (!rect) {
      return;
    }
    callback(rect);
  };

  const schedulePendingRectFlush = () => {
    if (animationFrame != null) {
      return;
    }

    animationFrame = window.requestAnimationFrame(flushPendingRect);
  };

  const unsubscribe = observeTanStackElementRect(instance, (rect) => {
    if (!isPanelResizeInProgress()) {
      cancelScheduledFlush();
      pendingRect = null;
      callback(rect);
      return;
    }

    pendingRect = rect;
  });

  const flushAfterPanelResize = () => {
    if (!pendingRect) {
      return;
    }
    cancelScheduledFlush();
    schedulePendingRectFlush();
  };

  window.addEventListener(panelResizeEndEvent, flushAfterPanelResize);

  return () => {
    cancelScheduledFlush();
    window.removeEventListener(panelResizeEndEvent, flushAfterPanelResize);
    unsubscribe?.();
  };
}
