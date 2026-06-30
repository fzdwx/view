import { describe, expect, test } from "bun:test";
import { resizeSessionPerfFields } from "./resizeHandlePerf";

describe("resizeSessionPerfFields", () => {
  test("includes handle identity fields for distinguishing resize sessions", () => {
    expect(
      resizeSessionPerfFields({
        axis: "x",
        className: "rail-left-top-splitter",
        label: "Resize left rail slot",
        commitMs: 0.04,
        frames: 4,
        totalDelta: 120,
        totalFlushMs: 12.32,
        maxRafWaitMs: 6.96,
      }),
    ).toEqual({
      axis: "x",
      avgFlushMs: 3.1,
      commitMs: 0,
      frames: 4,
      handleClassName: "rail-left-top-splitter",
      label: "Resize left rail slot",
      maxRafWaitMs: 7,
      mode: "live",
      totalDelta: 120,
    });
  });
});
