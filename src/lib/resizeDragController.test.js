import { describe, expect, test } from "bun:test";
import { createResizeDragController } from "./resizeDragController";

describe("resizeDragController", () => {
  test("live mode applies pending deltas during drag and commits total delta", () => {
    const liveDeltas = [];
    const endDeltas = [];
    const controller = createResizeDragController({
      mode: "live",
      onResize: (delta) => liveDeltas.push(delta),
      onResizeEnd: (delta) => endDeltas.push(delta),
    });

    controller.addDelta(8);
    controller.addDelta(4);
    controller.flush();
    controller.addDelta(-3);
    controller.finish();

    expect(liveDeltas).toEqual([12, -3]);
    expect(endDeltas).toEqual([9]);
  });

  test("deferred mode moves the guide during drag and commits layout once", () => {
    const liveDeltas = [];
    const guideDeltas = [];
    const endDeltas = [];
    const controller = createResizeDragController({
      mode: "deferred",
      onGuideDelta: (delta) => guideDeltas.push(delta),
      onResize: (delta) => liveDeltas.push(delta),
      onResizeEnd: (delta) => endDeltas.push(delta),
    });

    controller.addDelta(10);
    controller.addDelta(5);
    controller.flush();
    controller.addDelta(-2);
    controller.finish();

    expect(liveDeltas).toEqual([]);
    expect(guideDeltas).toEqual([15, 13]);
    expect(endDeltas).toEqual([13]);
  });
});
