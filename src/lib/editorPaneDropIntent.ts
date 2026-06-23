import type { PreviewSplitDirection } from "./previewPaneTypes";

export type EditorPaneDropIntent = `split-${PreviewSplitDirection}`;

export interface EditorPaneDropPoint {
  readonly clientX: number;
  readonly clientY: number;
}

export interface EditorPaneDropRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const dropZoneRatio = 0.62;

export function editorPaneDropIntent(
  point: EditorPaneDropPoint,
  rect: EditorPaneDropRect,
): EditorPaneDropIntent | null {
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const localX = point.clientX - rect.left;
  const localY = point.clientY - rect.top;
  if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) {
    return null;
  }

  const inRightZone = localX >= rect.width * dropZoneRatio;
  const inDownZone = localY >= rect.height * dropZoneRatio;
  if (!inRightZone && !inDownZone) {
    return null;
  }
  if (inRightZone && inDownZone) {
    return rect.width - localX <= rect.height - localY
      ? "split-right"
      : "split-down";
  }
  return inRightZone ? "split-right" : "split-down";
}

export function splitDirectionFromDropIntent(
  intent: EditorPaneDropIntent,
): PreviewSplitDirection {
  switch (intent) {
    case "split-right":
      return "right";
    case "split-down":
      return "down";
    default:
      return assertNeverEditorPaneDropIntent(intent);
  }
}

function assertNeverEditorPaneDropIntent(_intent: never): never {
  throw new Error("Unhandled editor pane drop intent");
}
