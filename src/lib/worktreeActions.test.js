import { describe, expect, test } from "bun:test";
import {
  defaultWorktreeBranchName,
  defaultWorktreeFolderName,
  isSameWorktreePath,
  worktreePathLabel,
} from "./worktreeActions";

describe("worktreeActions", () => {
  test("builds safe sibling folder defaults from local branches", () => {
    expect(defaultWorktreeFolderName("main")).toBe("main-worktree");
    expect(defaultWorktreeFolderName("feature/login")).toBe(
      "feature-login-worktree",
    );
  });

  test("builds new branch defaults from remote branches without the remote name", () => {
    const remoteBranch = {
      name: "origin/feature/login",
      branchType: "remote",
    };
    expect(defaultWorktreeBranchName(remoteBranch)).toBe("feature/login-worktree");
    expect(defaultWorktreeFolderName(remoteBranch)).toBe("feature-login-worktree");
  });

  test("labels worktree paths by their final folder on unix and windows paths", () => {
    expect(worktreePathLabel("/tmp/repo-feature")).toBe("repo-feature");
    expect(worktreePathLabel("C:\\src\\repo-feature\\")).toBe("repo-feature");
  });

  test("compares active worktree paths without trailing separator noise", () => {
    expect(isSameWorktreePath("/tmp/repo-feature", "/tmp/repo-feature/")).toBe(
      true,
    );
    expect(isSameWorktreePath("/tmp/repo-feature", "/tmp/repo-other")).toBe(
      false,
    );
  });
});
