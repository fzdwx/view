import { describe, expect, test } from "bun:test";
import { commitTrackingPresentation } from "./commitTracking";

describe("commitTrackingPresentation", () => {
  test("formats local-only commits as ahead of upstream", () => {
    const presentation = commitTrackingPresentation({
      tracking: {
        side: "local",
        label: "main",
        compareLabel: "origin/main",
      },
    });

    expect(presentation).toEqual({
      className: "commit-tracking-badge local",
      label: "main",
      title: "main contains this commit; origin/main does not.",
    });
  });

  test("formats upstream-only commits as ahead of local", () => {
    const presentation = commitTrackingPresentation({
      tracking: {
        side: "upstream",
        label: "origin/main",
        compareLabel: "main",
      },
    });

    expect(presentation).toEqual({
      className: "commit-tracking-badge upstream",
      label: "origin/main",
      title: "origin/main contains this commit; main does not.",
    });
  });

  test("does not render a badge for shared commits", () => {
    expect(commitTrackingPresentation({ tracking: null })).toBeNull();
  });
});
