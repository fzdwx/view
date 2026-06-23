import { describe, expect, test } from "bun:test";
import {
  closeTerminalPreviewTabs,
  createTerminalPreviewTab,
  restoreTerminalPreviewTabs,
} from "./previewPaneTerminalTabs";
import { createPreviewPaneLayout, openPreviewPaneTab } from "./previewPanes";

describe("previewPaneTerminalTabs", () => {
  test("creates a terminal preview tab with terminal identity", () => {
    const tab = createTerminalPreviewTab("/repo", "terminal-1", "repo");

    expect(tab).toEqual({
      id: "terminal:/repo:terminal-1",
      mode: "terminal",
      path: "repo",
      commit: null,
      projectPath: "/repo",
      terminalTabId: "terminal-1",
    });
  });

  test("routes terminal preview tabs through close and restore lifecycle", () => {
    const calls = [];
    const lifecycle = {
      close: (projectPath, terminalTabId) =>
        calls.push(`close:${projectPath}:${terminalTabId}`),
      restore: (projectPath, terminalTabId) =>
        calls.push(`restore:${projectPath}:${terminalTabId}`),
    };
    const tab = createTerminalPreviewTab("/repo", "terminal-1", "repo");
    const layout = openPreviewPaneTab(
      createPreviewPaneLayout(),
      "preview-pane-1",
      tab,
      null,
    );

    closeTerminalPreviewTabs([tab], lifecycle);
    restoreTerminalPreviewTabs(layout, lifecycle);

    expect(calls).toEqual([
      "close:/repo:terminal-1",
      "restore:/repo:terminal-1",
    ]);
  });
});
