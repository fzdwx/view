import { describe, expect, test } from "bun:test";
import {
  addTerminalTab,
  getTerminalWorkspace,
  setTerminalTabCwd,
} from "./terminalSessions";

describe("terminalSessions", () => {
  test("creates a terminal tab with a requested cwd", () => {
    const projectPath = `/repo-${Date.now()}`;

    const tab = addTerminalTab(projectPath, "/repo/packages/app");

    expect(tab.cwd).toBe("/repo/packages/app");
  });

  test("creates split terminal tabs with a distinct id and latest cwd", () => {
    const projectPath = `/repo-split-${Date.now()}`;
    const source = addTerminalTab(projectPath, "/repo");
    setTerminalTabCwd(projectPath, source.id, "/repo/packages/app");
    const latestSource = getTerminalWorkspace(projectPath).tabs.find(
      (tab) => tab.id === source.id,
    );

    const split = addTerminalTab(projectPath, latestSource?.cwd ?? null);

    expect(split.id).not.toBe(source.id);
    expect(split.cwd).toBe("/repo/packages/app");
    expect(getTerminalWorkspace(projectPath).activeTabId).toBe(split.id);
  });
});
