import { useEffect, useReducer, useRef } from "react";
import {
  isPanelResizeInProgress,
  panelResizeEndEvent,
  runAfterPanelResizeIdle,
  type PanelResizeIdleTaskHandle,
} from "../lib/panelResizeInteraction";

const DEFERRED_VALUE_AFTER_RESIZE_DELAY_MS = 120;

export function usePanelResizeDeferredValue<T>(value: T): T {
  const stableValueRef = useRef(value);
  const latestValueRef = useRef(value);
  const [, forceRender] = useReducer((version: number) => version + 1, 0);

  latestValueRef.current = value;
  if (!isPanelResizeInProgress()) {
    stableValueRef.current = value;
  }

  useEffect(() => {
    let pendingApplyHandle: PanelResizeIdleTaskHandle | null = null;
    const applyLatestValue = () => {
      pendingApplyHandle?.cancel();
      pendingApplyHandle = runAfterPanelResizeIdle(
        () => {
          pendingApplyHandle = null;
          if (Object.is(stableValueRef.current, latestValueRef.current)) {
            return;
          }
          stableValueRef.current = latestValueRef.current;
          forceRender();
        },
        {
          delayMs: DEFERRED_VALUE_AFTER_RESIZE_DELAY_MS,
          idleTimeoutMs: 500,
          timeoutMs: 16,
        },
      );
    };
    window.addEventListener(panelResizeEndEvent, applyLatestValue);
    return () => {
      pendingApplyHandle?.cancel();
      window.removeEventListener(panelResizeEndEvent, applyLatestValue);
    };
  }, []);

  return isPanelResizeInProgress() ? stableValueRef.current : value;
}
