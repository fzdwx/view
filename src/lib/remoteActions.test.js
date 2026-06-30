import { describe, expect, test } from "bun:test";
import {
  forceWithLeaseConfirmation,
  publishBranchLabel,
  remoteActionDisabledReason,
} from "./remoteActions";

describe("remoteActions", () => {
  test("validates remote names and URLs", () => {
    expect(remoteActionDisabledReason({
      activeProjectPath: "/repo",
      hasGitRepository: true,
      name: "",
      pendingReason: null,
      url: "git@example.test:repo.git",
    })).toBe("Enter a remote name.");
    expect(remoteActionDisabledReason({
      activeProjectPath: "/repo",
      hasGitRepository: true,
      name: "origin",
      pendingReason: null,
      url: "",
    })).toBe("Enter a remote URL.");
  });

  test("creates publish labels", () => {
    expect(publishBranchLabel("feature/work", "origin", null)).toBe(
      "Publish feature/work to origin/feature/work",
    );
    expect(publishBranchLabel("feature/work", "upstream", "review/work")).toBe(
      "Publish feature/work to upstream/review/work",
    );
  });

  test("creates force-with-lease confirmation copy", () => {
    expect(forceWithLeaseConfirmation("main", "origin/main")).toContain(
      "Force push main to origin/main with lease?",
    );
  });
});
