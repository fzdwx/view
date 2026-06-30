import { describe, expect, test } from "bun:test";
import {
  commitEditDisabledReason,
  commitEditConfirmation,
} from "./commitEditActions";

describe("commitEditActions", () => {
  test("reports disabled reasons", () => {
    expect(commitEditDisabledReason({
      activeProjectPath: null,
      hasGitRepository: true,
      pendingReason: null,
    })).toBe("Open a folder before editing history.");
    expect(commitEditDisabledReason({
      activeProjectPath: "/repo",
      hasGitRepository: false,
      pendingReason: null,
    })).toBe("Open a Git repository before editing history.");
  });

  test("creates confirmation copy", () => {
    expect(commitEditConfirmation("fixup", "abc1234")).toContain("Fixup abc1234");
    expect(commitEditConfirmation("squash", "abc1234")).toContain("Squash abc1234");
  });
});
