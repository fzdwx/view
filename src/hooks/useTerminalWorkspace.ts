import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  terminalKill,
  type TerminalSpawnOptions,
} from "../lib/api";
import { type AppSettings, loadAppSettings, settingsChangedEvent } from "../lib/settings";
import {
  addTerminalTab,
  clearPendingCommand,
  closeTerminalTab,
  createInitialTerminalWorkspace,
  getTerminalWorkspace,
  selectTerminalTab,
  setTerminalTabClosed,
  setTerminalTabCwd,
  setTerminalTabSession,
  setTerminalTabTitle,
  subscribeTerminalWorkspaces,
  type TerminalSessionInfo,
  type TerminalTab,
  type TerminalWorkspace,
} from "../lib/terminalSessions";
import {
  clearTerminalTabPlacement,
  subscribeTerminalTabPlacements,
  terminalTabPlacement,
  terminalTabPlacementVersion,
} from "../lib/terminalTabPlacement";

export interface TerminalWorkspaceController {
  readonly activePanelTab: TerminalTab | null;
  readonly autoCloseOnExit: boolean;
  readonly panelTabs: readonly TerminalTab[];
  readonly terminalOptions: TerminalSpawnOptions;
  readonly workspace: TerminalWorkspace;
  readonly addTab: (cwd?: string | null) => TerminalTab | null;
  readonly closeTab: (tabId: string) => void;
  readonly handleClosed: (tabId: string, exitCode: number | null) => void;
  readonly handlePendingCommandSent: (tabId: string) => void;
  readonly handleSessionReady: (tabId: string, session: TerminalSessionInfo) => void;
  readonly selectTab: (tabId: string) => void;
  readonly updateTabTitle: (tabId: string, title: string | null) => void;
  readonly updateTabCwd: (tabId: string, cwd: string | null) => void;
}

export function useTerminalWorkspace(
  projectPath: string | null,
): TerminalWorkspaceController {
  const workspace = useSyncExternalStore(
    subscribeTerminalWorkspaces,
    () => (projectPath ? getTerminalWorkspace(projectPath) : EMPTY_WORKSPACE),
    () => EMPTY_WORKSPACE,
  );
  const placementVersion = useSyncExternalStore(
    subscribeTerminalTabPlacements,
    terminalTabPlacementVersion,
    () => 0,
  );
  const [terminalOptions, setTerminalOptions] = useState<TerminalSpawnOptions>(
    () => toTerminalSpawnOptions(loadAppSettings().terminal),
  );
  const [autoCloseOnExit, setAutoCloseOnExit] = useState(
    () => loadAppSettings().terminal.autoCloseOnExit,
  );

  useEffect(() => {
    setTerminalOptions(toTerminalSpawnOptions(loadAppSettings().terminal));
    setAutoCloseOnExit(loadAppSettings().terminal.autoCloseOnExit);
    const handler = () => {
      setTerminalOptions(toTerminalSpawnOptions(loadAppSettings().terminal));
      setAutoCloseOnExit(loadAppSettings().terminal.autoCloseOnExit);
    };
    window.addEventListener(settingsChangedEvent, handler);
    return () => window.removeEventListener(settingsChangedEvent, handler);
  }, []);

  const panelTabs = useMemo(
    () =>
      projectPath
        ? workspace.tabs.filter(
            (tab) => terminalTabPlacement(projectPath, tab.id) === "panel",
          )
        : [],
    [placementVersion, projectPath, workspace],
  );
  const activePanelTab =
    panelTabs.find((tab) => tab.id === workspace.activeTabId) ??
    panelTabs[0] ??
    null;

  return {
    activePanelTab,
    autoCloseOnExit,
    panelTabs,
    terminalOptions,
    workspace,
    addTab: (cwd = null) => {
      if (projectPath) {
        return addTerminalTab(projectPath, cwd);
      }
      return null;
    },
    closeTab: (tabId) => {
      if (!projectPath) {
        return;
      }
      clearTerminalTabPlacement(projectPath, tabId);
      closeTerminalTab(projectPath, tabId, (session) => {
        void terminalKill(session.id).catch(() => undefined);
      });
    },
    handleClosed: (tabId, exitCode) => {
      if (!projectPath) {
        return;
      }
      const tab = getTerminalWorkspace(projectPath).tabs.find(
        (entry) => entry.id === tabId,
      );
      if (tab?.session) {
        void terminalKill(tab.session.id).catch(() => undefined);
      }
      if (autoCloseOnExit) {
        clearTerminalTabPlacement(projectPath, tabId);
        closeTerminalTab(projectPath, tabId, () => undefined);
        return;
      }
      setTerminalTabClosed(projectPath, tabId, exitCode);
    },
    handlePendingCommandSent: (tabId) => {
      if (projectPath) {
        clearPendingCommand(projectPath, tabId);
      }
    },
    handleSessionReady: (tabId, session) => {
      if (projectPath) {
        setTerminalTabSession(projectPath, tabId, session);
      }
    },
    selectTab: (tabId) => {
      if (projectPath) {
        selectTerminalTab(projectPath, tabId);
      }
    },
    updateTabTitle: (tabId, title) => {
      if (projectPath) {
        setTerminalTabTitle(projectPath, tabId, title);
      }
    },
    updateTabCwd: (tabId, cwd) => {
      if (projectPath) {
        setTerminalTabCwd(projectPath, tabId, cwd);
      }
    },
  };
}

export function toTerminalSpawnOptions(
  settings: AppSettings["terminal"],
): TerminalSpawnOptions {
  return {
    shell: settings.shell.trim(),
    cursorStyle: settings.cursorStyle,
    scrollbackLines: settings.scrollbackLines,
    visualBell: settings.visualBell,
  };
}

const EMPTY_WORKSPACE: TerminalWorkspace = createInitialTerminalWorkspace();
