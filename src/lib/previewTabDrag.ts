export const previewTabDragMime = "application/x-view-preview-tab";

export interface PreviewTabDragPayload {
  readonly tabId: string;
}

export function writePreviewTabDragData(
  dataTransfer: DataTransfer,
  payload: PreviewTabDragPayload,
): void {
  dataTransfer.setData(previewTabDragMime, JSON.stringify(payload));
}

export function hasPreviewTabDragData(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(previewTabDragMime);
}

export function readPreviewTabDragData(
  dataTransfer: DataTransfer,
): PreviewTabDragPayload | null {
  const raw = dataTransfer.getData(previewTabDragMime);
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
  if (!isPreviewTabDragPayload(parsed)) {
    return null;
  }
  return parsed;
}

function isPreviewTabDragPayload(
  value: unknown,
): value is PreviewTabDragPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "tabId" in value &&
    typeof value.tabId === "string"
  );
}
