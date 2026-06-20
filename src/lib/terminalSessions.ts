/**
 * Module-level terminal session store.
 *
 * Terminal workspaces (tabs + their live PTY session ids) must survive the
 * terminal panel being hidden, because the rail toggles the whole panel stack
 * out of the tree. Keeping this state in component state would destroy every
 * PTY the moment the panel unmounts. This store is keyed by project path so the
 * multi-project workspace can hold one terminal workspace per project.
 */

import type { TerminalSessionInfo as ApiTerminalSessionInfo } from "./api";
import { projectNameFromPath } from "./projects";

export type TerminalSessionInfo = ApiTerminalSessionInfo;

export interface TerminalTab {
  readonly id: string;
  readonly baseTitle: string;
  readonly title: string;
  /** Live PTY session for this tab, if one has been spawned. */
  readonly session: TerminalSessionInfo | null;
  /** Set when the PTY exits so the tab can render a closed state. */
  readonly closed: boolean;
  readonly exitCode: number | null;
}

export interface TerminalWorkspace {
  readonly tabs: TerminalTab[];
  readonly activeTabId: string;
  readonly nextTabIndex: number;
}

type Listener = () => void;

const workspaces = new Map<string, TerminalWorkspace>();
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) {
    listener();
    if (listeners.size === 0) {
      return;
    }
  }
}

function ensureWorkspace(projectPath: string): TerminalWorkspace {
  const existing = workspaces.get(projectPath);
  if (existing) {
    return existing;
  }
  const workspace = createInitialTerminalWorkspace(projectPath);
  workspaces.set(projectPath, workspace);
  return workspace;
}

function defaultTerminalBaseTitle(projectPath: string | null, index: number): string {
  const projectTitle =
    projectPath && projectPath.trim().length > 0
      ? projectNameFromPath(projectPath)
      : "Terminal";
  return index <= 1 ? projectTitle : `${projectTitle} ${index}`;
}

export function createInitialTerminalWorkspace(
  projectPath: string | null = null,
): TerminalWorkspace {
  const baseTitle = defaultTerminalBaseTitle(projectPath, 1);
  return {
    tabs: [
      {
        id: "terminal-1",
        baseTitle,
        title: baseTitle,
        session: null,
        closed: false,
        exitCode: null,
      },
    ],
    activeTabId: "terminal-1",
    nextTabIndex: 1,
  };
}

export function getTerminalWorkspace(projectPath: string): TerminalWorkspace {
  ensureWorkspace(projectPath);
  return workspaces.get(projectPath) ?? createInitialTerminalWorkspace(projectPath);
}

export function updateTerminalWorkspace(
  projectPath: string,
  mutate: (workspace: TerminalWorkspace) => TerminalWorkspace,
): void {
  const current = ensureWorkspace(projectPath);
  const next = mutate(current);
  if (next === current) {
    return;
  }
  workspaces.set(projectPath, next);
  emit();
}

export function addTerminalTab(projectPath: string): void {
  updateTerminalWorkspace(projectPath, (workspace) => {
    const nextIndex = workspace.nextTabIndex + 1;
    const baseTitle = defaultTerminalBaseTitle(projectPath, nextIndex);
    const tab: TerminalTab = {
      id: `terminal-${Date.now()}-${nextIndex}`,
      baseTitle,
      title: baseTitle,
      session: null,
      closed: false,
      exitCode: null,
    };
    return {
      tabs: [...workspace.tabs, tab],
      activeTabId: tab.id,
      nextTabIndex: nextIndex,
    };
  });
}

export function selectTerminalTab(projectPath: string, tabId: string): void {
  updateTerminalWorkspace(projectPath, (workspace) => {
    if (workspace.activeTabId === tabId) {
      return workspace;
    }
    return { ...workspace, activeTabId: tabId };
  });
}

export function closeTerminalTab(
  projectPath: string,
  tabId: string,
  onKillSession: (session: TerminalSessionInfo) => void,
): void {
  updateTerminalWorkspace(projectPath, (workspace) => {
    const index = workspace.tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) {
      return workspace;
    }
    const removed = workspace.tabs[index];
    if (removed.session) {
      onKillSession(removed.session);
    }
    const nextTabs = workspace.tabs.filter((tab) => tab.id !== tabId);
    const fallback = nextTabs[Math.max(0, index - 1)] ?? nextTabs[0] ?? null;
    return {
      tabs: nextTabs,
      activeTabId:
        workspace.activeTabId === tabId ? (fallback?.id ?? "") : workspace.activeTabId,
      nextTabIndex: workspace.nextTabIndex,
    };
  });
}

export function setTerminalTabSession(
  projectPath: string,
  tabId: string,
  session: TerminalSessionInfo,
): void {
  updateTerminalWorkspace(projectPath, (workspace) => ({
    ...workspace,
    tabs: workspace.tabs.map((tab) =>
      tab.id === tabId ? { ...tab, session, closed: false, exitCode: null } : tab,
    ),
  }));
}

export function setTerminalTabTitle(
  projectPath: string,
  tabId: string,
  title: string | null,
): void {
  updateTerminalWorkspace(projectPath, (workspace) => {
    let changed = false;
    const nextTabs = workspace.tabs.map((tab) => {
      if (tab.id !== tabId) {
        return tab;
      }
      const nextTitle = title?.trim() || tab.baseTitle;
      if (tab.title === nextTitle) {
        return tab;
      }
      changed = true;
      return { ...tab, title: nextTitle };
    });
    if (!changed) {
      return workspace;
    }
    return { ...workspace, tabs: nextTabs };
  });
}

export function setTerminalTabClosed(
  projectPath: string,
  tabId: string,
  exitCode: number | null,
): void {
  updateTerminalWorkspace(projectPath, (workspace) => ({
    ...workspace,
    tabs: workspace.tabs.map((tab) =>
      tab.id === tabId ? { ...tab, closed: true, exitCode } : tab,
    ),
  }));
}

export function subscribeTerminalWorkspaces(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
