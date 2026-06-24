import { useEffect, useReducer, useRef } from "react";
import {
  isPanelResizeInProgress,
  panelResizeEndEvent,
} from "../lib/panelResizeInteraction";

export function usePanelResizeDeferredValue<T>(value: T): T {
  const stableValueRef = useRef(value);
  const latestValueRef = useRef(value);
  const [, forceRender] = useReducer((version: number) => version + 1, 0);

  latestValueRef.current = value;
  if (!isPanelResizeInProgress()) {
    stableValueRef.current = value;
  }

  useEffect(() => {
    const applyLatestValue = () => {
      if (Object.is(stableValueRef.current, latestValueRef.current)) {
        return;
      }
      stableValueRef.current = latestValueRef.current;
      forceRender();
    };
    window.addEventListener(panelResizeEndEvent, applyLatestValue);
    return () =>
      window.removeEventListener(panelResizeEndEvent, applyLatestValue);
  }, []);

  return isPanelResizeInProgress() ? stableValueRef.current : value;
}
