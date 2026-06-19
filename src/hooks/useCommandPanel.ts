import { useCallback, useEffect, useRef, useState } from "react";

export type CommandPanelMode = "files" | "content";

export interface UseCommandPanelOptions {
  readonly activeProjectPath: string | null;
}

export interface CommandPanelController {
  readonly commandMode: CommandPanelMode;
  readonly commandOpen: boolean;
  readonly commandQuery: string;
  readonly commandSelectionIndex: number;
  readonly debouncedCommandQuery: string;
  readonly closeCommandPanel: () => void;
  readonly openCommandPanel: (mode?: CommandPanelMode) => void;
  readonly setCommandMode: (mode: CommandPanelMode) => void;
  readonly setCommandQuery: (query: string) => void;
  readonly setCommandSelectionIndex: (index: number) => void;
}

export function useCommandPanel({
  activeProjectPath,
}: UseCommandPanelOptions): CommandPanelController {
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandMode, setCommandMode] = useState<CommandPanelMode>("files");
  const [commandQuery, setCommandQuery] = useState("");
  const [debouncedCommandQuery, setDebouncedCommandQuery] = useState("");
  const [commandSelectionIndex, setCommandSelectionIndex] = useState(0);
  const commandRestoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedCommandQuery(commandQuery.trim());
    }, 120);

    return () => window.clearTimeout(timer);
  }, [commandQuery]);

  // Reset the selection to the first result whenever the query/mode/project
  // changes. The result list lives in the consumer (App.tsx), so the active
  // index can't be derived here; the reset is the only signal available.
  useEffect(() => {
    /* oxlint-disable react-doctor/no-adjust-state-on-prop-change, react-doctor/no-derived-state-effect, react-doctor/no-chain-state-updates */
    setCommandSelectionIndex(0);
    /* oxlint-enable react-doctor/no-adjust-state-on-prop-change, react-doctor/no-derived-state-effect, react-doctor/no-chain-state-updates */
  }, [debouncedCommandQuery, activeProjectPath, commandMode]);

  const openCommandPanel = useCallback((mode: CommandPanelMode = "files") => {
    commandRestoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCommandOpen(true);
    setCommandMode(mode);
    setCommandQuery("");
    setDebouncedCommandQuery("");
    setCommandSelectionIndex(0);
  }, []);

  const closeCommandPanel = useCallback(() => {
    setCommandOpen(false);
    setCommandQuery("");
    setDebouncedCommandQuery("");
    setCommandSelectionIndex(0);
    const element = commandRestoreFocusRef.current;
    commandRestoreFocusRef.current = null;
    window.requestAnimationFrame(() => {
      if (!element || !document.contains(element)) {
        return;
      }
      element.focus({ preventScroll: true });
    });
  }, []);

  return {
    commandMode,
    commandOpen,
    commandQuery,
    commandSelectionIndex,
    debouncedCommandQuery,
    closeCommandPanel,
    openCommandPanel,
    setCommandMode,
    setCommandQuery,
    setCommandSelectionIndex,
  };
}
