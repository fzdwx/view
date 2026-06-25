import { describe, expect, test } from "bun:test";
import {
  addTerminalTab,
  getTerminalWorkspace,
  runInRunTab,
  setTerminalTabClosed,
  setTerminalTabCwd,
} from "./terminalSessions";

describe("terminalSessions", () => {
  test("creates a terminal tab with a requested cwd", () => {
    const projectPath = `/repo-${Date.now()}`;

    const tab = addTerminalTab(projectPath, "/repo/packages/app");

    expect(tab.cwd).toBe("/repo/packages/app");
    expect(tab.kind).toBe("terminal");
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

  test("creates run tabs with pending command and env overrides", () => {
    const projectPath = `/repo-run-${Date.now()}`;

    runInRunTab(projectPath, "go test ./pkg", "Run tests", "/repo", {
      VIEW_ENV: "test",
    });

    const workspace = getTerminalWorkspace(projectPath);
    const tab = workspace.tabs.find((entry) => entry.kind === "run");

    expect(tab?.title).toBe("Run tests");
    expect(tab?.cwd).toBe("/repo");
    expect(tab?.pendingCommand).toBe("go test ./pkg");
    expect(tab?.env).toEqual({ VIEW_ENV: "test" });
    expect(tab?.runConfigurationId).toBeUndefined();
    expect(workspace.activeTabId).toBe(tab?.id);
  });

  test("keeps one running tab per run configuration", () => {
    const projectPath = `/repo-run-dedupe-${Date.now()}`;

    runInRunTab(
      projectPath,
      "go run ./cmd/server",
      "Run main",
      "/repo",
      {},
      "run-main",
    );
    const firstWorkspace = getTerminalWorkspace(projectPath);
    const firstTab = firstWorkspace.tabs.find(
      (entry) => entry.kind === "run" && entry.runConfigurationId === "run-main",
    );

    runInRunTab(
      projectPath,
      "go run ./cmd/server",
      "Run main",
      "/repo",
      {},
      "run-main",
    );

    const workspace = getTerminalWorkspace(projectPath);
    const runTabs = workspace.tabs.filter(
      (entry) => entry.kind === "run" && entry.runConfigurationId === "run-main",
    );
    expect(runTabs).toHaveLength(1);
    expect(runTabs[0].id).toBe(firstTab?.id);
    expect(workspace.activeTabId).toBe(firstTab?.id);
  });

  test("reruns a finished run configuration in one replacement tab", () => {
    const projectPath = `/repo-run-rerun-${Date.now()}`;

    runInRunTab(
      projectPath,
      "go run ./cmd/server",
      "Run main",
      "/repo",
      {},
      "run-main",
    );
    const firstTab = getTerminalWorkspace(projectPath).tabs.find(
      (entry) => entry.kind === "run" && entry.runConfigurationId === "run-main",
    );
    if (!firstTab) {
      throw new Error("Expected run tab to exist");
    }
    setTerminalTabClosed(projectPath, firstTab.id, 0);

    runInRunTab(
      projectPath,
      "go run ./cmd/server",
      "Run main",
      "/repo",
      { VIEW_ENV: "rerun" },
      "run-main",
    );

    const workspace = getTerminalWorkspace(projectPath);
    const runTabs = workspace.tabs.filter(
      (entry) => entry.kind === "run" && entry.runConfigurationId === "run-main",
    );
    expect(runTabs).toHaveLength(1);
    expect(runTabs[0].id).not.toBe(firstTab.id);
    expect(runTabs[0].pendingCommand).toBe("go run ./cmd/server");
    expect(runTabs[0].env).toEqual({ VIEW_ENV: "rerun" });
    expect(workspace.activeTabId).toBe(runTabs[0].id);
  });
});
