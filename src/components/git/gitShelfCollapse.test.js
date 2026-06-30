import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const worktreeListSource = readFileSync(
  new URL("./WorktreeList.tsx", import.meta.url),
  "utf8",
);
const stashListSource = readFileSync(
  new URL("./StashList.tsx", import.meta.url),
  "utf8",
);

describe("git shelf collapse controls", () => {
  test("worktree and stash shelf titles are disclosure buttons", () => {
    expect(worktreeListSource).toContain("className=\"worktree-list-toggle\"");
    expect(worktreeListSource).toContain("aria-expanded={expanded}");
    expect(worktreeListSource).toContain("{expanded ? (");

    expect(stashListSource).toContain("className=\"stash-list-toggle\"");
    expect(stashListSource).toContain("aria-expanded={expanded}");
    expect(stashListSource).toContain("{expanded ? (");
  });

  test("state shelves are compact by default", () => {
    expect(worktreeListSource).toContain("useState(false)");
    expect(stashListSource).toContain("useState(false)");
  });
});
