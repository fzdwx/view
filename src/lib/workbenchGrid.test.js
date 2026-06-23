import { describe, expect, test } from "bun:test";
import { railSideHasIcons } from "./workbenchGrid";
import { defaultRailLayout } from "./workbenchTypes";

describe("railSideHasIcons", () => {
  test("returns false when a rail side has no icons", () => {
    expect(railSideHasIcons(defaultRailLayout, "right")).toBe(false);
  });

  test("returns true when a rail side has top or bottom icons", () => {
    expect(railSideHasIcons(defaultRailLayout, "left")).toBe(true);
    expect(
      railSideHasIcons(
        {
          left: { top: [], bottom: [] },
          right: { top: ["git"], bottom: [] },
        },
        "right",
      ),
    ).toBe(true);
  });
});
