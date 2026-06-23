import { describe, expect, test } from "bun:test";
import { stageableFilePaths, unstageableFilePaths } from "./gitBatchFileActions";

describe("git batch file actions", () => {
  test("collects stageable worktree and untracked file paths", () => {
    const files = [
      { path: "src/modified.ts", status: "modified", unstaged: true },
      { path: "src/new.ts", status: "untracked", untracked: true },
      { path: "src/staged.ts", status: "modified", staged: true },
    ];

    expect(stageableFilePaths(files)).toEqual(["src/modified.ts", "src/new.ts"]);
  });

  test("collects unstageable index file paths", () => {
    const files = [
      { path: "src/staged.ts", status: "modified", staged: true },
      { path: "src/mixed.ts", status: "modified", staged: true, unstaged: true },
      { path: "src/unstaged.ts", status: "modified", unstaged: true },
    ];

    expect(unstageableFilePaths(files)).toEqual(["src/staged.ts", "src/mixed.ts"]);
  });

  test("keeps mixed files available for both batch actions", () => {
    const files = [
      { path: "src/mixed.ts", status: "modified", staged: true, unstaged: true },
    ];

    expect(stageableFilePaths(files)).toEqual(["src/mixed.ts"]);
    expect(unstageableFilePaths(files)).toEqual(["src/mixed.ts"]);
  });

  test("excludes conflicted files and deduplicates paths", () => {
    const files = [
      { path: "src/a.ts", status: "modified", unstaged: true },
      { path: "src/a.ts", status: "modified", unstaged: true },
      { path: "src/conflict.ts", status: "conflict", conflict: true, staged: true },
    ];

    expect(stageableFilePaths(files)).toEqual(["src/a.ts"]);
    expect(unstageableFilePaths(files)).toEqual([]);
  });
});
