import { describe, expect, test } from "bun:test";
import { activateProjectPath } from "./projects";

describe("projects", () => {
  test("switches an existing project to a worktree active path", () => {
    const projects = [
      {
        id: "repo-1",
        name: "repo",
        rootPath: "/tmp/repo",
        activePath: "/tmp/repo",
      },
    ];

    const result = activateProjectPath(projects, "/tmp/repo", "/tmp/repo-feature");

    expect(result.projectId).toBe("repo-1");
    expect(result.projects).toEqual([
      {
        id: "repo-1",
        name: "repo",
        rootPath: "/tmp/repo",
        activePath: "/tmp/repo-feature",
      },
    ]);
  });

  test("adds a project when switching to a worktree from an unseen root", () => {
    const result = activateProjectPath([], "/tmp/repo", "/tmp/repo-feature");

    expect(result.projectId).toBeTruthy();
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toMatchObject({
      name: "repo",
      rootPath: "/tmp/repo",
      activePath: "/tmp/repo-feature",
    });
  });
});
