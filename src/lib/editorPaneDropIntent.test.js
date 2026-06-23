import { describe, expect, test } from "bun:test";
import {
  editorPaneDropIntent,
  splitDirectionFromDropIntent,
} from "./editorPaneDropIntent";

const rect = {
  left: 100,
  top: 50,
  width: 400,
  height: 300,
};

describe("editorPaneDropIntent", () => {
  test("returns split-right when dragging over the right side", () => {
    const intent = editorPaneDropIntent({ clientX: 390, clientY: 120 }, rect);

    expect(intent).toBe("split-right");
    expect(splitDirectionFromDropIntent(intent)).toBe("right");
  });

  test("returns split-down when dragging over the bottom side", () => {
    const intent = editorPaneDropIntent({ clientX: 180, clientY: 280 }, rect);

    expect(intent).toBe("split-down");
    expect(splitDirectionFromDropIntent(intent)).toBe("down");
  });

  test("does not split from the center of the pane", () => {
    expect(editorPaneDropIntent({ clientX: 220, clientY: 140 }, rect)).toBeNull();
  });

  test("chooses the nearest edge in the bottom-right corner", () => {
    expect(editorPaneDropIntent({ clientX: 492, clientY: 300 }, rect)).toBe(
      "split-right",
    );
    expect(editorPaneDropIntent({ clientX: 430, clientY: 346 }, rect)).toBe(
      "split-down",
    );
  });
});
