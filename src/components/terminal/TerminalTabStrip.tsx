import type { DragEvent } from "react";
import { Plus, TerminalSquare, X } from "lucide-react";
import type { TerminalTab } from "../../lib/terminalSessions";
import { writeTerminalTabDragData } from "../../lib/terminalTabDrag";

export interface TerminalTabStripProps {
  readonly activeTabId: string;
  readonly projectPath: string;
  readonly tabs: readonly TerminalTab[];
  readonly onAddTab: () => void;
  readonly onCloseTab: (tabId: string) => void;
  readonly onSelectTab: (tabId: string) => void;
}

export function TerminalTabStrip({
  activeTabId,
  projectPath,
  tabs,
  onAddTab,
  onCloseTab,
  onSelectTab,
}: TerminalTabStripProps) {
  return (
    <div className="terminal-header">
      <div className="terminal-header-title" aria-label="Terminal">
        <TerminalSquare size={14} />
      </div>
      <button
        type="button"
        className="terminal-tab-add"
        aria-label="New terminal"
        title="New terminal"
        onClick={onAddTab}
      >
        <Plus size={14} />
      </button>
      <div className="terminal-tabs" role="tablist" aria-label="Terminals">
        {tabs.map((tab) => (
          <TerminalTabItem
            key={tab.id}
            active={tab.id === activeTabId}
            projectPath={projectPath}
            tab={tab}
            onCloseTab={onCloseTab}
            onSelectTab={onSelectTab}
          />
        ))}
      </div>
    </div>
  );
}

function TerminalTabItem({
  active,
  projectPath,
  tab,
  onCloseTab,
  onSelectTab,
}: {
  readonly active: boolean;
  readonly projectPath: string;
  readonly tab: TerminalTab;
  readonly onCloseTab: (tabId: string) => void;
  readonly onSelectTab: (tabId: string) => void;
}) {
  return (
    <div
      className={active ? "terminal-tab-shell terminal-tab-active" : "terminal-tab-shell"}
      draggable
      onDragStart={(event) => handleDragStart(event, projectPath, tab)}
    >
      <button
        type="button"
        className="terminal-tab"
        role="tab"
        aria-selected={active}
        onClick={() => onSelectTab(tab.id)}
      >
        <span>{tab.title}</span>
      </button>
      <button
        type="button"
        className="terminal-tab-close"
        aria-label={`Close ${tab.title}`}
        onClick={() => onCloseTab(tab.id)}
      >
        <X size={12} />
      </button>
    </div>
  );
}

function handleDragStart(
  event: DragEvent<HTMLDivElement>,
  projectPath: string,
  tab: TerminalTab,
): void {
  event.dataTransfer.effectAllowed = "move";
  writeTerminalTabDragData(event.dataTransfer, {
    projectPath,
    tabId: tab.id,
    title: tab.title,
  });
}
