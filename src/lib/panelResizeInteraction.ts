export const panelResizeStartEvent = "view:panel-resize-start";
export const panelResizeEndEvent = "view:panel-resize-end";

export function dispatchPanelResizeStart(): void {
  window.dispatchEvent(new CustomEvent(panelResizeStartEvent));
}

export function dispatchPanelResizeEnd(): void {
  window.dispatchEvent(new CustomEvent(panelResizeEndEvent));
}

export function isPanelResizeInProgress(): boolean {
  return (
    document.body.classList.contains("is-resizing-x") ||
    document.body.classList.contains("is-resizing-y")
  );
}
