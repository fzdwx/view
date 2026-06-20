import { parentPathFromPath } from "./pathLabels";

export function clipboardFilesFromEvent(
  event: globalThis.ClipboardEvent,
): File[] {
  const dataTransfer = event.clipboardData;
  if (!dataTransfer) {
    return [];
  }

  const files: File[] = [];
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== "file") {
      continue;
    }
    const file = item.getAsFile();
    if (file) {
      files.push(file);
    }
  }
  if (files.length > 0) {
    return files;
  }
  return Array.from(dataTransfer.files);
}

export function pasteDestinationFromSelectedPath(
  selectedPath: string | null,
): string | null {
  if (!selectedPath) {
    return null;
  }
  if (selectedPath.endsWith("/")) {
    return selectedPath.replace(/\/+$/, "");
  }
  const parentPath = parentPathFromPath(selectedPath);
  return parentPath || null;
}
