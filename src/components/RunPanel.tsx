import { memo, useCallback, useEffect, useMemo, useReducer } from "react";
import { Play, Plus, Settings2, Trash2, X } from "lucide-react";
import { isTauriRuntime } from "../lib/api";
import {
  formatRunEnvText,
  loadRunConfigurations,
  parseRunEnvText,
  recordRunConfigurationLaunch,
  runConfigurationCommand,
  runConfigurationEnvRecord,
  runConfigurationTabIdentity,
  runConfigurationsChangedEvent,
  saveRunConfigurations,
  updateRunConfiguration,
  upsertRunConfiguration,
  type RunConfiguration,
} from "../lib/runConfigurations";
import { runInRunTab } from "../lib/terminalSessions";
import { useTerminalWorkspace } from "../hooks/useTerminalWorkspace";
import { TerminalSessionView } from "./TerminalPanel";
import { TerminalTabStrip } from "./terminal/TerminalTabStrip";

interface RunPanelProps {
  readonly active: boolean;
  readonly projectPath: string | null;
}

interface RunConfigurationDraft {
  readonly label: string;
  readonly command: string;
  readonly args: string;
  readonly cwd: string;
  readonly envText: string;
  readonly singleInstance: boolean;
}

const emptyDraft: RunConfigurationDraft = {
  label: "",
  command: "",
  args: "",
  cwd: "",
  envText: "",
  singleInstance: true,
};

interface RunPanelState {
  readonly configurations: readonly RunConfiguration[];
  readonly selectedConfigurationId: string | null;
  readonly draft: RunConfigurationDraft;
  readonly settingsOpen: boolean;
}

type RunPanelAction =
  | {
      readonly type: "load";
      readonly configurations: readonly RunConfiguration[];
      readonly preferredId?: string | null;
      readonly settingsOpen?: boolean;
    }
  | { readonly type: "select"; readonly id: string }
  | { readonly type: "patchDraft"; readonly patch: Partial<RunConfigurationDraft> }
  | { readonly type: "setSettingsOpen"; readonly open: boolean };

function initialRunPanelState(projectPath: string | null): RunPanelState {
  return runPanelStateFromConfigurations(
    projectPath ? loadRunConfigurations(projectPath) : [],
    null,
    false,
  );
}

function runPanelReducer(
  state: RunPanelState,
  action: RunPanelAction,
): RunPanelState {
  switch (action.type) {
    case "load":
      return runPanelStateFromConfigurations(
        action.configurations,
        action.preferredId ?? state.selectedConfigurationId,
        action.settingsOpen ?? state.settingsOpen,
      );
    case "select":
      return runPanelStateFromConfigurations(
        state.configurations,
        action.id,
        state.settingsOpen,
      );
    case "patchDraft":
      return {
        ...state,
        draft: { ...state.draft, ...action.patch },
      };
    case "setSettingsOpen":
      return { ...state, settingsOpen: action.open };
  }
}

function runPanelStateFromConfigurations(
  configurations: readonly RunConfiguration[],
  preferredId: string | null,
  settingsOpen: boolean,
): RunPanelState {
  const selectedConfiguration =
    configurations.find((configuration) => configuration.id === preferredId) ??
    configurations[0] ??
    null;

  return {
    configurations,
    selectedConfigurationId: selectedConfiguration?.id ?? null,
    draft: selectedConfiguration
      ? draftFromConfiguration(selectedConfiguration)
      : emptyDraft,
    settingsOpen: selectedConfiguration ? settingsOpen : false,
  };
}

export const RunPanel = memo(function RunPanel({
  active,
  projectPath,
}: RunPanelProps) {
  const runWorkspace = useTerminalWorkspace(projectPath, "run");
  const [runPanelState, dispatchRunPanel] = useReducer(
    runPanelReducer,
    projectPath,
    initialRunPanelState,
  );
  const {
    configurations,
    draft,
    selectedConfigurationId,
    settingsOpen,
  } = runPanelState;
  const selectedConfiguration =
    configurations.find((configuration) => configuration.id === selectedConfigurationId) ??
    configurations[0] ??
    null;

  useEffect(() => {
    if (!projectPath) {
      dispatchRunPanel({ type: "load", configurations: [] });
      return;
    }

    const load = () => {
      const next = loadRunConfigurations(projectPath);
      dispatchRunPanel({ type: "load", configurations: next });
    };

    load();
    const handleChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ projectPath?: string }>).detail;
      if (!detail?.projectPath || detail.projectPath === projectPath) {
        load();
      }
    };
    window.addEventListener(runConfigurationsChangedEvent, handleChanged);
    return () =>
      window.removeEventListener(runConfigurationsChangedEvent, handleChanged);
  }, [projectPath]);

  const canRun = Boolean(projectPath && draft.command.trim());
  const canEdit = Boolean(projectPath && selectedConfiguration);
  const runTerminalOptions = useMemo(
    () => ({
      ...runWorkspace.terminalOptions,
      env: runWorkspace.activePanelTab?.env ?? {},
    }),
    [runWorkspace.activePanelTab?.env, runWorkspace.terminalOptions],
  );

  const persistConfiguration = useCallback(() => {
    if (!projectPath || !selectedConfiguration) {
      return null;
    }
    const nextConfiguration: RunConfiguration = {
      ...selectedConfiguration,
      label: draft.label.trim() || draft.command.trim() || selectedConfiguration.label,
      command: draft.command.trim(),
      args: draft.args.trim(),
      cwd: draft.cwd.trim() || null,
      env: parseRunEnvText(draft.envText),
      singleInstance: draft.singleInstance,
      updatedAt: Date.now(),
    };
    const nextConfigurations = updateRunConfiguration(
      configurations,
      nextConfiguration,
    );
    saveRunConfigurations(projectPath, nextConfigurations);
    dispatchRunPanel({
      type: "load",
      configurations: nextConfigurations,
      preferredId: nextConfiguration.id,
    });
    return nextConfiguration;
  }, [configurations, draft, projectPath, selectedConfiguration]);

  const handleRun = useCallback(() => {
    if (!projectPath || !canRun) {
      return;
    }
    const configuration = persistConfiguration();
    if (!configuration) {
      return;
    }
    runInRunTab(
      projectPath,
      runConfigurationCommand(configuration),
      configuration.label,
      configuration.cwd,
      runConfigurationEnvRecord(configuration),
      runConfigurationTabIdentity(configuration),
    );
    const launchedConfigurations = recordRunConfigurationLaunch(
      nextConfigurationsAfterPersist(configurations, configuration),
      configuration.id,
    );
    saveRunConfigurations(projectPath, launchedConfigurations);
    dispatchRunPanel({
      type: "load",
      configurations: launchedConfigurations,
      preferredId: configuration.id,
      settingsOpen: false,
    });
  }, [canRun, configurations, persistConfiguration, projectPath]);

  const handleSave = useCallback(() => {
    if (!persistConfiguration()) {
      return;
    }
    dispatchRunPanel({ type: "setSettingsOpen", open: false });
  }, [persistConfiguration]);

  const handleCreateConfiguration = useCallback(() => {
    if (!projectPath) {
      return;
    }
    const { configuration, configurations: nextConfigurations } =
      upsertRunConfiguration(configurations, {
        projectPath,
        sourceId: `custom:${Date.now()}`,
        label: "Custom",
        command: "",
    });
    saveRunConfigurations(projectPath, nextConfigurations);
    dispatchRunPanel({
      type: "load",
      configurations: nextConfigurations,
      preferredId: configuration.id,
      settingsOpen: true,
    });
  }, [configurations, projectPath]);

  const handleDeleteConfiguration = useCallback(() => {
    if (!projectPath || !selectedConfiguration) {
      return;
    }
    const nextConfigurations = configurations.filter(
      (configuration) => configuration.id !== selectedConfiguration.id,
    );
    saveRunConfigurations(projectPath, nextConfigurations);
    dispatchRunPanel({
      type: "load",
      configurations: nextConfigurations,
      preferredId: nextConfigurations[0]?.id ?? null,
      settingsOpen: false,
    });
  }, [configurations, projectPath, selectedConfiguration]);

  if (!projectPath || !isTauriRuntime()) {
    const unavailableMessage = !projectPath
      ? "Open a folder first."
      : "Run is available in Tauri.";
    return (
      <section className="run-panel">
        <div className="terminal-empty">{unavailableMessage}</div>
      </section>
    );
  }

  return (
    <section className="run-panel" aria-label="Run">
      <aside className="run-config-list" aria-label="Run configurations">
        <div className="run-config-toolbar">
          <button
            type="button"
            className="run-config-icon-button"
            aria-label="New run configuration"
            title="New run configuration"
            onClick={handleCreateConfiguration}
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            className="run-config-icon-button run-config-primary-action"
            aria-label="Run selected configuration"
            title="Run selected configuration"
            disabled={!canRun}
            onClick={handleRun}
          >
            <Play size={14} />
          </button>
          <button
            type="button"
            className="run-config-icon-button"
            aria-label="Edit selected run configuration"
            title="Edit selected run configuration"
            disabled={!canEdit}
            onClick={() =>
              dispatchRunPanel({ type: "setSettingsOpen", open: true })
            }
          >
            <Settings2 size={14} />
          </button>
          <button
            type="button"
            className="run-config-icon-button"
            aria-label="Delete run configuration"
            title="Delete run configuration"
            disabled={!selectedConfiguration}
            onClick={handleDeleteConfiguration}
          >
            <Trash2 size={14} />
          </button>
        </div>
        <div className="run-config-items">
          {configurations.length > 0 ? (
            configurations.map((configuration) => (
              <button
                key={configuration.id}
                type="button"
                className={
                  configuration.id === selectedConfiguration?.id
                    ? "run-config-item active"
                    : "run-config-item"
                }
                title={configuration.command}
                onClick={() =>
                  dispatchRunPanel({ type: "select", id: configuration.id })
                }
                onDoubleClick={() =>
                  dispatchRunPanel({ type: "setSettingsOpen", open: true })
                }
              >
                <span>{configuration.label}</span>
                <code>{configuration.command}</code>
                <small>{runConfigurationMeta(configuration)}</small>
              </button>
            ))
          ) : (
            <div className="run-config-empty">No run configurations.</div>
          )}
        </div>
      </aside>
      {settingsOpen && selectedConfiguration ? (
        <dialog className="run-config-popover" aria-label="Run settings" open>
          <div className="run-config-popover-header">
            <span>Run settings</span>
            <button
              type="button"
              className="run-config-icon-button"
              aria-label="Close run settings"
              title="Close run settings"
              onClick={() =>
                dispatchRunPanel({ type: "setSettingsOpen", open: false })
              }
            >
              <X size={14} />
            </button>
          </div>
          <div className="run-config-form">
            <label>
              <span>Name</span>
              <input
                value={draft.label}
                onChange={(event) =>
                  dispatchRunPanel({
                    type: "patchDraft",
                    patch: { label: event.target.value },
                  })
                }
              />
            </label>
            <label>
              <span>Command</span>
              <input
                value={draft.command}
                onChange={(event) =>
                  dispatchRunPanel({
                    type: "patchDraft",
                    patch: { command: event.target.value },
                  })
                }
              />
            </label>
            <label>
              <span>Arguments</span>
              <input
                value={draft.args}
                onChange={(event) =>
                  dispatchRunPanel({
                    type: "patchDraft",
                    patch: { args: event.target.value },
                  })
                }
              />
            </label>
            <label>
              <span>Working directory</span>
              <input
                value={draft.cwd}
                onChange={(event) =>
                  dispatchRunPanel({
                    type: "patchDraft",
                    patch: { cwd: event.target.value },
                  })
                }
              />
            </label>
            <label className="run-config-env-field">
              <span>Environment</span>
              <textarea
                value={draft.envText}
                spellCheck={false}
                onChange={(event) =>
                  dispatchRunPanel({
                    type: "patchDraft",
                    patch: { envText: event.target.value },
                  })
                }
              />
            </label>
            <label className="run-config-checkbox-field">
              <input
                type="checkbox"
                checked={draft.singleInstance}
                onChange={(event) =>
                  dispatchRunPanel({
                    type: "patchDraft",
                    patch: { singleInstance: event.target.checked },
                  })
                }
              />
              <span>Reuse one running tab for this configuration</span>
            </label>
          </div>
          <div className="run-config-popover-footer">
            <button
              type="button"
              className="run-config-secondary-button"
              onClick={handleSave}
            >
              Save
            </button>
            <button
              type="button"
              className="run-config-run-button"
              disabled={!canRun}
              onClick={handleRun}
            >
              <Play size={14} />
              <span>Run</span>
            </button>
          </div>
        </dialog>
      ) : null}
      <div className="run-output-panel">
        <TerminalTabStrip
          activeTabId={runWorkspace.activePanelTab?.id ?? ""}
          draggableTabs={false}
          label="Run"
          projectPath={projectPath}
          tabs={runWorkspace.panelTabs}
          onAddTab={runWorkspace.addTab}
          onCloseTab={runWorkspace.closeTab}
          onSelectTab={runWorkspace.selectTab}
        />
        <div className="terminal-session-stack">
          {runWorkspace.activePanelTab ? (
            <div className="terminal-session-layer">
              <TerminalSessionView
                key={runWorkspace.activePanelTab.id}
                active={active}
                cwd={runWorkspace.activePanelTab.cwd}
                projectPath={projectPath}
                session={runWorkspace.activePanelTab.session}
                terminalOptions={runTerminalOptions}
                env={runWorkspace.activePanelTab.env}
                pendingCommand={runWorkspace.activePanelTab.pendingCommand}
                onTitleChange={(title) =>
                  runWorkspace.updateTabTitle(
                    runWorkspace.activePanelTab?.id ?? "",
                    title,
                  )
                }
                onWorkingDirectoryChange={(cwd) =>
                  runWorkspace.updateTabCwd(
                    runWorkspace.activePanelTab?.id ?? "",
                    cwd,
                  )
                }
                onSessionReady={(session) =>
                  runWorkspace.handleSessionReady(
                    runWorkspace.activePanelTab?.id ?? "",
                    session,
                  )
                }
                onPendingCommandSent={() =>
                  runWorkspace.handlePendingCommandSent(
                    runWorkspace.activePanelTab?.id ?? "",
                  )
                }
                onClosed={(exitCode) =>
                  runWorkspace.handleClosed(
                    runWorkspace.activePanelTab?.id ?? "",
                    exitCode,
                  )
                }
              />
            </div>
          ) : (
            <div className="run-output-empty">Run a configuration to see output.</div>
          )}
        </div>
      </div>
    </section>
  );
});

RunPanel.displayName = "RunPanel";

function draftFromConfiguration(
  configuration: RunConfiguration,
): RunConfigurationDraft {
  return {
    label: configuration.label,
    command: configuration.command,
    args: configuration.args,
    cwd: configuration.cwd ?? "",
    envText: formatRunEnvText(configuration.env),
    singleInstance: configuration.singleInstance,
  };
}

function nextConfigurationsAfterPersist(
  configurations: readonly RunConfiguration[],
  configuration: RunConfiguration,
): readonly RunConfiguration[] {
  return [
    configuration,
    ...configurations.filter((entry) => entry.id !== configuration.id),
  ];
}

function runConfigurationMeta(configuration: RunConfiguration): string {
  const runCount = configuration.runCount;
  if (!configuration.lastRunAt) {
    return runCount > 0 ? `${runCount} runs` : "Not run yet";
  }
  const date = new Date(configuration.lastRunAt);
  return `${runCount} run${runCount === 1 ? "" : "s"} · ${date.toLocaleString()}`;
}
