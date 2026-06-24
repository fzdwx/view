import { useSyncExternalStore } from "react";
import {
  isPanelResizeInProgress,
  panelResizeEndEvent,
  panelResizeStartEvent,
} from "../lib/panelResizeInteraction";

export function usePanelResizeActive(): boolean {
  return useSyncExternalStore(
    subscribeToPanelResize,
    isPanelResizeInProgress,
    () => false,
  );
}

function subscribeToPanelResize(onStoreChange: () => void): () => void {
  window.addEventListener(panelResizeStartEvent, onStoreChange);
  window.addEventListener(panelResizeEndEvent, onStoreChange);
  return () => {
    window.removeEventListener(panelResizeStartEvent, onStoreChange);
    window.removeEventListener(panelResizeEndEvent, onStoreChange);
  };
}
