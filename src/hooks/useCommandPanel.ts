import { useCallback, useEffect, useRef, useState } from "react";

export interface UseCommandPanelOptions {
  readonly activeProjectPath: string | null;
}

export interface CommandPanelController {
  readonly commandOpen: boolean;
  readonly commandQuery: string;
  readonly commandSelectionIndex: number;
  readonly debouncedCommandQuery: string;
  readonly closeCommandPanel: () => void;
  readonly openCommandPanel: () => void;
  readonly setCommandQuery: (query: string) => void;
  readonly setCommandSelectionIndex: (index: number) => void;
}

export function useCommandPanel({
  activeProjectPath,
}: UseCommandPanelOptions): CommandPanelController {
  const [commandOpen, setCommandOpen] = useState(false);
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

  useEffect(() => {
    setCommandSelectionIndex(0);
  }, [debouncedCommandQuery, activeProjectPath]);

  const openCommandPanel = useCallback(() => {
    commandRestoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCommandOpen(true);
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
    commandOpen,
    commandQuery,
    commandSelectionIndex,
    debouncedCommandQuery,
    closeCommandPanel,
    openCommandPanel,
    setCommandQuery,
    setCommandSelectionIndex,
  };
}
