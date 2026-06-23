import { describe, expect, test } from "bun:test";
import { commitPanelFiles } from "./commitPanelFiles";

describe("commitPanelFiles", () => {
  test("uses working tree files instead of the active commit file list", () => {
    const worktreeFiles = [
      {
        path: "staged.ts",
        status: "modified",
        staged: true,
        unstaged: false,
      },
    ];
    const activeCommitFiles = [
      {
        path: "historical.ts",
        status: "modified",
        staged: false,
        unstaged: false,
      },
    ];

    expect(
      commitPanelFiles(
        { files: worktreeFiles },
        activeCommitFiles,
      ).map((file) => file.path),
    ).toEqual(["staged.ts"]);
  });

  test("does not show stale active commit files before repository data is ready", () => {
    expect(
      commitPanelFiles(undefined, [
        { path: "historical.ts", status: "modified" },
      ]),
    ).toEqual([]);
  });
});
