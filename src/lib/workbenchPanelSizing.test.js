import { describe, expect, test } from "bun:test";
import {
  railBottomInnerPanelMax,
  railBottomPanelFallbackMax,
  railBottomPanelMax,
  railSidePanelMax,
} from "./workbenchPanelSizing";

describe("workbenchPanelSizing", () => {
  test("allows bottom panels to grow until the editor is hidden", () => {
    expect(railBottomPanelMax(1000)).toBe(994);
  });

  test("allows bottom panels to use short viewports too", () => {
    expect(railBottomPanelMax(320)).toBe(314);
  });

  test("allows side panels to hide the editor while preserving the opposite side", () => {
    expect(
      railSidePanelMax({
        containerWidth: 1200,
        hasOppositePanel: true,
        oppositePanelWidth: 300,
      }),
    ).toBe(888);
  });

  test("allows a side panel to fill the workbench when it has no opposite side", () => {
    expect(
      railSidePanelMax({
        containerWidth: 1200,
        hasOppositePanel: false,
        oppositePanelWidth: 300,
      }),
    ).toBe(1194);
  });

  test("allows the bottom inner split to hide the opposite panel", () => {
    expect(railBottomInnerPanelMax(1200)).toBe(1190);
  });

  test("uses a permissive fallback before the workbench is measured", () => {
    expect(railBottomPanelMax(null)).toBe(railBottomPanelFallbackMax);
  });
});
