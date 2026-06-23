import { hasTerminalTabDragData } from "./terminalTabDrag";

export interface TerminalTabEditorDropCandidate {
  readonly dataTransfer: DataTransfer;
  readonly isWithinEditorPane: boolean;
}

export function acceptsTerminalTabEditorDrop({
  dataTransfer,
  isWithinEditorPane,
}: TerminalTabEditorDropCandidate): boolean {
  return isWithinEditorPane && hasTerminalTabDragData(dataTransfer);
}
