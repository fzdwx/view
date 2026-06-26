import { useEffect } from "react";
import type { AppSettings } from "../lib/settings";
import { matchesShortcut } from "../lib/keyboardShortcuts";
import type { PreviewMode } from "../lib/previewTabs";
import type { ToolPanelId } from "../lib/workbenchTypes";

interface UseAppKeyboardShortcutsOptions {
  readonly canUseProjectCommands: boolean;
  readonly commandOpen: boolean;
  readonly hasActiveEditorDraft: boolean;
  readonly hasActiveTab: boolean;
  readonly previewMode: PreviewMode;
  readonly pullChoiceOpen: boolean;
  readonly shortcuts: AppSettings["shortcuts"];
  readonly onCloseActiveTab: () => void;
  readonly onCloseCommandPanel: () => void;
  readonly onClosePullChoice: () => void;
  readonly onOpenCommandPanel: () => void;
  readonly onOpenFindFiles: () => void;
  readonly onOpenFindInFiles: () => void;
  readonly onOpenFindReferences: () => void;
  readonly onOpenPullChoice: () => void;
  readonly onSaveActiveFile: () => void;
  readonly onSelectToolPanelView: (view: ToolPanelId) => void;
  readonly onSwitchTab: (direction: 1 | -1) => void;
  readonly onToggleProjectSwitcher: () => void;
  readonly onJumpToDiffFile: () => void;
}
export function useAppKeyboardShortcuts({
  canUseProjectCommands,
  commandOpen,
  hasActiveEditorDraft,
  hasActiveTab,
  previewMode,
  pullChoiceOpen,
  shortcuts,
  onCloseActiveTab,
  onCloseCommandPanel,
  onClosePullChoice,
  onOpenCommandPanel,
  onOpenFindFiles,
  onOpenFindInFiles,
  onOpenFindReferences,
  onOpenPullChoice,
  onSaveActiveFile,
  onSelectToolPanelView,
  onSwitchTab,
  onToggleProjectSwitcher,
  onJumpToDiffFile,
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

      if (matchesShortcut(event, shortcuts.findFiles)) {
        event.preventDefault();
        if (canUseProjectCommands) {
          onOpenFindFiles();
        }
        return;
      }

      if (matchesShortcut(event, shortcuts.findInFiles)) {
        event.preventDefault();
        if (canUseProjectCommands) {
          onOpenFindInFiles();
        }
        return;
      }

      if (matchesShortcut(event, shortcuts.findReferences)) {
        event.preventDefault();
        if (canUseProjectCommands) {
          onOpenFindReferences();
        }
        return;
      }

      if (matchesShortcut(event, shortcuts.saveFile)) {
        if (
          !editableTarget ||
          event.target instanceof HTMLTextAreaElement ||
          isCodeMirrorShortcutTarget(event.target)
        ) {
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

      if (matchesShortcut(event, shortcuts.openFileTree)) {
        event.preventDefault();
        if (canUseProjectCommands) {
          onSelectToolPanelView("project");
        }
        return;
      }

      if (matchesShortcut(event, shortcuts.openRunPanel)) {
        event.preventDefault();
        if (canUseProjectCommands) {
          onSelectToolPanelView("run");
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

      if (matchesShortcut(event, shortcuts.jumpToDiffFile)) {
        if (previewMode === "diff") {
          event.preventDefault();
          onJumpToDiffFile();
        }
        return;
      }

      if (matchesShortcut(event, shortcuts.closeTab)) {
        if (hasActiveTab) {
          event.preventDefault();
          onCloseActiveTab();
        }
        return;
      }

      if (matchesShortcut(event, shortcuts.nextTab)) {
        if (hasActiveTab) {
          event.preventDefault();
          onSwitchTab(1);
        }
        return;
      }

      if (matchesShortcut(event, shortcuts.prevTab)) {
        if (hasActiveTab) {
          event.preventDefault();
          onSwitchTab(-1);
        }
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
    hasActiveTab,
    previewMode,
    pullChoiceOpen,
    shortcuts,
    onCloseActiveTab,
    onCloseCommandPanel,
    onClosePullChoice,
    onOpenCommandPanel,
    onOpenFindFiles,
    onOpenFindInFiles,
    onOpenFindReferences,
    onOpenPullChoice,
    onSaveActiveFile,
    onSelectToolPanelView,
    onSwitchTab,
    onToggleProjectSwitcher,
    onJumpToDiffFile,
  ]);
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.matches("input, textarea, [contenteditable='true']") ||
      Boolean(target.closest("[data-command-panel]")))
  );
}

function isCodeMirrorShortcutTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest(".cm-editor"));
}
