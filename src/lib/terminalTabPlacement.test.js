import { describe, expect, test } from "bun:test";
import {
  clearTerminalTabPlacement,
  dockTerminalTabToEditor,
  restoreTerminalTabToPanel,
  terminalTabPlacement,
  terminalTabPlacementVersion,
} from "./terminalTabPlacement";

describe("terminalTabPlacement", () => {
  test("defaults to panel and can move a tab to editor and back", () => {
    const projectPath = "/repo";
    const tabId = `terminal-${Date.now()}`;

    expect(terminalTabPlacement(projectPath, tabId)).toBe("panel");

    dockTerminalTabToEditor(projectPath, tabId);
    expect(terminalTabPlacement(projectPath, tabId)).toBe("editor");

    restoreTerminalTabToPanel(projectPath, tabId);
    expect(terminalTabPlacement(projectPath, tabId)).toBe("panel");

    clearTerminalTabPlacement(projectPath, tabId);
    expect(terminalTabPlacement(projectPath, tabId)).toBe("panel");
  });

  test("increments version when placement changes", () => {
    const projectPath = "/repo";
    const tabId = `terminal-${Date.now()}-version`;
    const initialVersion = terminalTabPlacementVersion();

    dockTerminalTabToEditor(projectPath, tabId);

    expect(terminalTabPlacementVersion()).toBe(initialVersion + 1);
  });
});
