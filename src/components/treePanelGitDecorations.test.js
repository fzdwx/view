import { describe, expect, test } from "bun:test";
import { treeGitStageDecoration } from "./treePanelGitDecorations";

describe("treeGitStageDecoration", () => {
  test("marks staged files with a staged badge", () => {
    expect(
      treeGitStageDecoration({
        path: "src/staged.ts",
        status: "modified",
        staged: true,
        unstaged: false,
      }),
    ).toEqual({ text: "S", title: "Staged change" });
  });

  test("marks unstaged files with an unstaged badge", () => {
    expect(
      treeGitStageDecoration({
        path: "src/unstaged.ts",
        status: "modified",
        staged: false,
        unstaged: true,
      }),
    ).toEqual({ text: "U", title: "Unstaged change" });
  });

  test("treats untracked files as unstaged worktree changes", () => {
    expect(
      treeGitStageDecoration({
        path: "src/untracked.ts",
        status: "untracked",
        staged: false,
        untracked: true,
        unstaged: false,
      }),
    ).toEqual({ text: "U", title: "Unstaged change" });
  });

  test("marks files that have both staged and unstaged changes", () => {
    expect(
      treeGitStageDecoration({
        path: "src/mixed.ts",
        status: "modified",
        staged: true,
        unstaged: true,
      }),
    ).toEqual({ text: "S/U", title: "Staged and unstaged changes" });
  });

  test("does not decorate clean files", () => {
    expect(
      treeGitStageDecoration({
        path: "src/clean.ts",
        status: null,
        staged: false,
        unstaged: false,
      }),
    ).toBeNull();
  });
});
