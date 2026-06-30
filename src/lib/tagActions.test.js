import { describe, expect, test } from "bun:test";
import {
  createTagTargetLabel,
  normalizeTagActionInput,
  tagActionDisabledReason,
} from "./tagActions";

describe("tagActions", () => {
  test("normalizes tag names and messages", () => {
    expect(normalizeTagActionInput({
      message: "  Release 1.0  ",
      name: " refs/tags/v1.0.0 ",
    })).toEqual({
      message: "Release 1.0",
      name: "v1.0.0",
    });
  });

  test("reports disabled reasons for invalid tag input", () => {
    expect(tagActionDisabledReason({
      activeProjectPath: "/repo",
      hasGitRepository: true,
      name: "",
      pendingReason: null,
    })).toBe("Enter a tag name.");
    expect(tagActionDisabledReason({
      activeProjectPath: "/repo",
      hasGitRepository: true,
      name: "bad\0tag",
      pendingReason: null,
    })).toBe("Tag name cannot contain NUL bytes.");
  });

  test("creates default tag target labels", () => {
    expect(createTagTargetLabel(null)).toBe("HEAD");
    expect(createTagTargetLabel("refs/heads/main")).toBe("main");
    expect(createTagTargetLabel("abcdef1234567890")).toBe("abcdef1");
  });
});
