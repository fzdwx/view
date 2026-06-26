import { describe, expect, test } from "bun:test";
import {
  hasGitConflictMarkers,
  resolveGitConflictMarkers,
} from "./editorDrafts";

describe("editorDrafts conflict markers", () => {
  test("resolves regular conflict markers", () => {
    const content = [
      "before",
      "<<<<<<< HEAD",
      "ours",
      "=======",
      "theirs",
      ">>>>>>> branch",
      "after",
      "",
    ].join("\n");

    expect(hasGitConflictMarkers(content)).toBe(true);
    expect(resolveGitConflictMarkers(content, "ours")).toBe(
      "before\nours\nafter\n",
    );
    expect(resolveGitConflictMarkers(content, "theirs")).toBe(
      "before\ntheirs\nafter\n",
    );
    expect(resolveGitConflictMarkers(content, "both")).toBe(
      "before\nours\ntheirs\nafter\n",
    );
  });

  test("ignores diff3 base section", () => {
    const content = [
      "<<<<<<< HEAD",
      "ours",
      "||||||| base",
      "base",
      "=======",
      "theirs",
      ">>>>>>> branch",
    ].join("\n");

    expect(resolveGitConflictMarkers(content, "both")).toBe("ours\ntheirs");
  });
});
