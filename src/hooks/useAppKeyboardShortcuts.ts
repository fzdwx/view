import { useEffect } from "react";
import type { AppSettings } from "../lib/settings";
import { matchesShortcut } from "../lib/keyboardShortcuts";
import type { PreviewMode } from "../lib/previewTabs";
import type { ToolPanelId } from "../lib/workbenchTypes";

interface UseAppKeyboardShortcutsOptions {
  readonly canUseProjectCommands: boolean;
  readonly commandOpen: boolean;
  readonly hasActiveEditorDraft: boolean;
  readonly previewMode: PreviewMode;
  readonly pullChoiceOpen: boolean;
  readonly shortcuts: AppSettings["shortcuts"];
  readonly onCloseCommandPanel: () => void;
  readonly onClosePullChoice: () => void;
  readonly onOpenCommandPanel: () => void;
  readonly onOpenPullChoice: () => void;
  readonly onSaveActiveFile: () => void;
  readonly onSelectToolPanelView: (view: ToolPanelId) => void;
  readonly onToggleProjectSwitcher: () => void;
}

export function useAppKeyboardShortcuts({
  canUseProjectCommands,
  commandOpen,
  hasActiveEditorDraft,
  previewMode,
  pullChoiceOpen,
  shortcuts,
  onCloseCommandPanel,
  onClosePullChoice,
  onOpenCommandPanel,
  onOpenPullChoice,
  onSaveActiveFile,
  onSelectToolPanelView,
  onToggleProjectSwitcher,
}: UseAppKeyboardShortcutsOptions): void {
  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      const editableTarget = isEditableShortcutTarget(event.target);

      if (matchesShortcut(event, shortcuts.commandPanel)) {
        event.preventDefault();
        if (canUseProjectCommands) {
          onOpenCommandPanel();
        }
        return;
      }

      if (matchesShortcut(event, shortcuts.saveFile)) {
        if (!editableTarget || event.target instanceof HTMLTextAreaElement) {
          event.preventDefault();
          if (previewMode === "file" && hasActiveEditorDraft) {
            onSaveActiveFile();
          }
        }
        return;
      }

      if (matchesShortcut(event, shortcuts.pullCurrentBranch)) {
        event.preventDefault();
        onOpenPullChoice();
        return;
      }

      if (matchesShortcut(event, shortcuts.openGitLog)) {
        event.preventDefault();
        if (canUseProjectCommands) {
          onSelectToolPanelView("git");
        }
        return;
      }

      if (matchesShortcut(event, shortcuts.openTerminal)) {
        event.preventDefault();
        if (canUseProjectCommands) {
          onSelectToolPanelView("terminal");
        }
        return;
      }

      if (matchesShortcut(event, shortcuts.switchProject)) {
        event.preventDefault();
        onToggleProjectSwitcher();
        return;
      }

      if (event.key === "Escape" && pullChoiceOpen) {
        event.preventDefault();
        onClosePullChoice();
        return;
      }

      if (event.key === "Escape" && commandOpen && !editableTarget) {
        event.preventDefault();
        onCloseCommandPanel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    canUseProjectCommands,
    commandOpen,
    hasActiveEditorDraft,
    previewMode,
    pullChoiceOpen,
    shortcuts,
    onCloseCommandPanel,
    onClosePullChoice,
    onOpenCommandPanel,
    onOpenPullChoice,
    onSaveActiveFile,
    onSelectToolPanelView,
    onToggleProjectSwitcher,
  ]);
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.matches("input, textarea, [contenteditable='true']") ||
      Boolean(target.closest("[data-command-panel]")))
  );
}
