export const terminalTabDragMime = "application/x-view-terminal-tab";

export interface TerminalTabDragPayload {
  readonly projectPath: string;
  readonly tabId: string;
  readonly title: string;
}

export function writeTerminalTabDragData(
  dataTransfer: DataTransfer,
  payload: TerminalTabDragPayload,
): void {
  dataTransfer.setData(terminalTabDragMime, JSON.stringify(payload));
}

export function hasTerminalTabDragData(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(terminalTabDragMime);
}

export function readTerminalTabDragData(
  dataTransfer: DataTransfer,
): TerminalTabDragPayload | null {
  const raw = dataTransfer.getData(terminalTabDragMime);
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
  return isTerminalTabDragPayload(parsed) ? parsed : null;
}

function isTerminalTabDragPayload(
  value: unknown,
): value is TerminalTabDragPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "projectPath" in value &&
    typeof value.projectPath === "string" &&
    "tabId" in value &&
    typeof value.tabId === "string" &&
    "title" in value &&
    typeof value.title === "string"
  );
}
