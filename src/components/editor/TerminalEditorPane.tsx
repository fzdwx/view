import { isTauriRuntime } from "../../lib/api";
import type { TerminalPreviewTab } from "../../lib/previewTabs";
import { useTerminalWorkspace } from "../../hooks/useTerminalWorkspace";
import { TerminalSessionView } from "../TerminalPanel";
import { PaneEmpty } from "./PreviewPaneStates";

export function TerminalEditorPane({
  active,
  tab,
}: {
  readonly active: boolean;
  readonly tab: TerminalPreviewTab;
}) {
  const terminalWorkspace = useTerminalWorkspace(tab.projectPath);
  const terminalTab =
    terminalWorkspace.workspace.tabs.find((entry) => entry.id === tab.terminalTabId) ??
    null;

  if (!isTauriRuntime()) {
    return (
      <PaneEmpty
        title="Terminal Unavailable"
        copy="Terminal is available in Tauri."
      />
    );
  }
  if (!terminalTab) {
    return (
      <PaneEmpty
        title="Terminal Closed"
        copy="This terminal session is no longer available."
      />
    );
  }

  return (
    <div className="editor-terminal-pane">
      <TerminalSessionView
        key={terminalTab.id}
        active={active}
        cwd={terminalTab.cwd}
        projectPath={tab.projectPath}
        session={terminalTab.session}
        terminalOptions={terminalWorkspace.terminalOptions}
        pendingCommand={terminalTab.pendingCommand}
        onTitleChange={(title) =>
          terminalWorkspace.updateTabTitle(terminalTab.id, title)
        }
        onWorkingDirectoryChange={(cwd) =>
          terminalWorkspace.updateTabCwd(terminalTab.id, cwd)
        }
        onSessionReady={(session) =>
          terminalWorkspace.handleSessionReady(terminalTab.id, session)
        }
        onPendingCommandSent={() =>
          terminalWorkspace.handlePendingCommandSent(terminalTab.id)
        }
        onClosed={(exitCode) =>
          terminalWorkspace.handleClosed(terminalTab.id, exitCode)
        }
      />
    </div>
  );
}
