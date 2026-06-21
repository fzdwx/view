import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Command,
  FileTerminal,
  Server,
  SquareTerminal,
  Terminal,
  TerminalSquare,
} from "lucide-react";
import { isTauriRuntime, listTerminalShells, type TerminalShell } from "../../lib/api";
import {
  type AppSettings,
  type TerminalCursorStyle,
  defaultTerminalSettings,
  terminalScrollbackMax,
  terminalScrollbackMin,
  terminalScrollbackStep,
} from "../../lib/settings";
import { SettingsSelect, type SettingsSelectOption } from "./SettingsSelect";
import { SettingsSegmented, type SegmentedOption } from "./SettingsSegmented";
import { SettingsSlider } from "./SettingsSlider";

const cursorStyleOptions: readonly SegmentedOption[] = [
  { label: "Block", value: "block" },
  { label: "Bar", value: "bar" },
  { label: "Underline", value: "underline" },
  { label: "Hollow", value: "hollowBlock" },
];

interface SettingsTerminalProps {
  readonly settings: AppSettings;
  readonly onChange: (settings: AppSettings) => void;
}

export function SettingsTerminal({ settings, onChange }: SettingsTerminalProps) {
  const terminal = settings.terminal;

  const update = (patch: Partial<AppSettings["terminal"]>) => {
    onChange({ ...settings, terminal: { ...terminal, ...patch } });
  };

  const { data: shells } = useQuery({
    queryKey: ["terminal-shells"],
    queryFn: listTerminalShells,
    enabled: isTauriRuntime(),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const shellOptions = useMemo<readonly SettingsSelectOption[]>(
    () => buildShellOptions(shells ?? []),
    [shells],
  );

  return (
    <div className="font-cards">
      <section className="font-card">
        <header className="font-card-heading">
          <h3>Shell</h3>
          <p>
            Executable launched for each terminal tab. System default uses the
            platform's configured shell.
          </p>
        </header>
        <SettingsSelect
          ariaLabel="Shell executable"
          fallbackLabel="System default"
          menuSize="large"
          options={shellOptions}
          searchable={true}
          searchPlaceholder="Search shells"
          value={terminal.shell}
          onChange={(value) => update({ shell: value })}
        />
      </section>

      <section className="font-card">
        <header className="font-card-heading">
          <h3>Cursor</h3>
          <p>Shape of the terminal text cursor.</p>
        </header>
        <SettingsSegmented
          ariaLabel="Terminal cursor shape"
          options={cursorStyleOptions}
          value={terminal.cursorStyle}
          onChange={(value) =>
            update({ cursorStyle: value as TerminalCursorStyle })
          }
        />
      </section>

      <section className="font-card">
        <header className="font-card-heading">
          <h3>Scrollback</h3>
          <p>Lines of history retained per terminal tab.</p>
        </header>
        <div className="font-control">
          <div className="font-control-label">
            <span>History</span>
            <output className="font-control-value">
              {terminal.scrollbackLines.toLocaleString()}
            </output>
          </div>
          <SettingsSlider
            ariaLabel="Terminal scrollback lines"
            max={terminalScrollbackMax}
            min={terminalScrollbackMin}
            step={terminalScrollbackStep}
            value={terminal.scrollbackLines}
            onChange={(value) => update({ scrollbackLines: value })}
          />
        </div>
      </section>

      <section className="font-card">
        <header className="font-card-heading">
          <h3>Behavior</h3>
        </header>
        <label className="settings-toggle-row">
          <span className="settings-toggle-label">
            Flash on bell instead of ringing
          </span>
          <input
            aria-label="Visual bell"
            checked={terminal.visualBell}
            className="settings-toggle"
            type="checkbox"
            onChange={(event) => update({ visualBell: event.currentTarget.checked })}
          />
        </label>
        <label className="settings-toggle-row">
          <span className="settings-toggle-label">
            Close the tab when its process exits
          </span>
          <input
            aria-label="Auto-close on exit"
            checked={terminal.autoCloseOnExit}
            className="settings-toggle"
            type="checkbox"
            onChange={(event) =>
              update({ autoCloseOnExit: event.currentTarget.checked })
            }
          />
        </label>
      </section>
    </div>
  );
}

function buildShellOptions(shells: readonly TerminalShell[]): SettingsSelectOption[] {
  const options: SettingsSelectOption[] = [
    {
      icon: <SquareTerminal size={14} />,
      label: "System default",
      value: defaultTerminalSettings.shell,
    },
  ];
  for (const shell of shells) {
    if (shell.path !== defaultTerminalSettings.shell) {
      options.push({
        icon: shellIcon(shell.label),
        label: shell.path === shell.label ? shell.label : `${shell.label} — ${shell.path}`,
        value: shell.path,
      });
    }
  }
  return options;
}

function shellIcon(label: string) {
  const name = label.toLowerCase();
  if (name.includes("powershell") || name.includes("pwsh")) {
    return <Command size={14} />;
  }
  if (name === "cmd" || name === "command prompt") {
    return <Command size={14} />;
  }
  if (name === "nu") {
    return <Server size={14} />;
  }
  if (name === "fish") {
    return <FileTerminal size={14} />;
  }
  if (name === "elvish" || name === "xonsh") {
    return <FileTerminal size={14} />;
  }
  if (name === "tcsh" || name === "csh") {
    return <TerminalSquare size={14} />;
  }
  if (name === "bash" || name === "zsh" || name === "sh") {
    return <Terminal size={14} />;
  }
  return <Terminal size={14} />;
}
