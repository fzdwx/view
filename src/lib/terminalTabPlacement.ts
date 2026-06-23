import { getTerminalWorkspace } from "./terminalSessions";

export type TerminalTabPlacement = "panel" | "editor";

type Listener = () => void;

export const terminalPanelEmptyEvent = "view:terminal-panel-empty";

export interface TerminalPanelEmptyEventDetail {
  readonly projectPath: string;
}

const placements = new Map<string, TerminalTabPlacement>();
const listeners = new Set<Listener>();
let version = 0;

export function terminalTabPlacement(
  projectPath: string,
  tabId: string,
): TerminalTabPlacement {
  return placements.get(terminalPlacementKey(projectPath, tabId)) ?? "panel";
}

export function terminalTabPlacementVersion(): number {
  return version;
}

export function dockTerminalTabToEditor(
  projectPath: string,
  tabId: string,
): void {
  const changed = setTerminalTabPlacement(projectPath, tabId, "editor");
  if (changed && panelTabCount(projectPath) === 0) {
    emitTerminalPanelEmpty(projectPath);
  }
}

export function restoreTerminalTabToPanel(
  projectPath: string,
  tabId: string,
): void {
  setTerminalTabPlacement(projectPath, tabId, "panel");
}

export function clearTerminalTabPlacement(projectPath: string, tabId: string): void {
  const key = terminalPlacementKey(projectPath, tabId);
  if (!placements.delete(key)) {
    return;
  }
  emit();
}

export function subscribeTerminalTabPlacements(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setTerminalTabPlacement(
  projectPath: string,
  tabId: string,
  placement: TerminalTabPlacement,
): boolean {
  const key = terminalPlacementKey(projectPath, tabId);
  if (terminalTabPlacement(projectPath, tabId) === placement) {
    return false;
  }
  placements.set(key, placement);
  emit();
  return true;
}

function terminalPlacementKey(projectPath: string, tabId: string): string {
  return `${projectPath}\0${tabId}`;
}

function emit(): void {
  version += 1;
  for (const listener of listeners) {
    listener();
  }
}

function panelTabCount(projectPath: string): number {
  return getTerminalWorkspace(projectPath).tabs.filter(
    (tab) => terminalTabPlacement(projectPath, tab.id) === "panel",
  ).length;
}

function emitTerminalPanelEmpty(projectPath: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<TerminalPanelEmptyEventDetail>(
      terminalPanelEmptyEvent,
      { detail: { projectPath } },
    ),
  );
}
