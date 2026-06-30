import { describe, expect, test } from "bun:test";
import {
  buildProjectStateRefreshPlan,
  queryKeyNames,
} from "./projectStateInvalidation";

const projectPath = "/repo/view";

function fingerprint({
  head = "head-a",
  summary = "summary-a",
  status = "status-a",
} = {}) {
  return {
    fingerprint: `${head}:${summary}:${status}`,
    headFingerprint: head,
    summaryFingerprint: summary,
    statusFingerprint: status,
  };
}

describe("buildProjectStateRefreshPlan", () => {
  test("primes without invalidating queries on the first fingerprint", () => {
    const plan = buildProjectStateRefreshPlan({
      previous: null,
      next: fingerprint(),
      projectPath,
    });

    expect(plan.result).toBe("primed");
    expect(plan.invalidateKeys).toEqual([]);
    expect(plan.resetKeys).toEqual([]);
    expect(plan.cancelKeys).toEqual([]);
  });

  test("does not invalidate when the fingerprint is unchanged", () => {
    const previous = fingerprint();
    const plan = buildProjectStateRefreshPlan({
      previous,
      next: previous,
      projectPath,
    });

    expect(plan.result).toBe("unchanged");
    expect(plan.invalidateKeys).toEqual([]);
    expect(plan.resetKeys).toEqual([]);
    expect(plan.cancelKeys).toEqual([]);
  });

  test("refreshes history and worktree queries when HEAD changes", () => {
    const plan = buildProjectStateRefreshPlan({
      previous: fingerprint(),
      next: fingerprint({ head: "head-b" }),
      projectPath,
      activeCommit: "abc123",
    });

    expect(plan.result).toBe("changed");
    expect(queryKeyNames(plan.invalidateKeys)).toEqual([
      "repository",
      "commits",
      "reflog",
      "project-files",
      "changed-files",
      "git-operation-state",
      "stashes",
    ]);
    expect(plan.invalidateKeys).toContainEqual(["changed-files", projectPath, null]);
    expect(plan.invalidateKeys).not.toContainEqual([
      "changed-files",
      projectPath,
      "abc123",
    ]);
  });

  test("refreshes worktree queries while a historical commit is selected", () => {
    const plan = buildProjectStateRefreshPlan({
      previous: fingerprint(),
      next: fingerprint({ status: "status-b" }),
      projectPath,
      activeCommit: "abc123",
    });

    expect(queryKeyNames(plan.invalidateKeys)).toEqual([
      "repository",
      "project-files",
      "changed-files",
      "git-operation-state",
      "stashes",
    ]);
    expect(plan.invalidateKeys).toContainEqual(["changed-files", projectPath, null]);
  });

  test("resets preview metadata when worktree content or HEAD changes", () => {
    const plan = buildProjectStateRefreshPlan({
      previous: fingerprint(),
      next: fingerprint({ status: "status-b" }),
      projectPath,
    });

    expect(queryKeyNames(plan.cancelKeys)).toEqual([
      "file-blame",
      "file-content",
      "file-staged-diff",
      "file-worktree-diff",
      "file-diff",
    ]);
    expect(queryKeyNames(plan.resetKeys)).toEqual([
      "file-blame",
      "file-content",
      "file-staged-diff",
      "file-worktree-diff",
      "file-diff",
    ]);
  });
});
