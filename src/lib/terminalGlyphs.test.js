import { describe, expect, test } from "bun:test";
import { terminalBlockRects, terminalBoxSegments } from "./terminalGlyphs";

describe("terminalGlyphs", () => {
  test("maps vertical box drawing glyphs to connected segments", () => {
    expect(terminalBoxSegments("│")).toEqual({ top: true, bottom: true });
  });

  test("maps left block fractions to solid rectangles", () => {
    expect(terminalBlockRects("▏")).toEqual([
      { top: "0", right: "87.5%", bottom: "0", left: "0" },
    ]);
    expect(terminalBlockRects("▌")).toEqual([
      { top: "0", right: "50%", bottom: "0", left: "0" },
    ]);
  });

  test("maps opencode logo block glyphs without falling back to font rendering", () => {
    expect(terminalBlockRects("█")).toEqual([{ top: "0", right: "0", bottom: "0", left: "0" }]);
    expect(terminalBlockRects("▀")).toEqual([
      { top: "0", right: "0", bottom: "50%", left: "0" },
    ]);
    expect(terminalBlockRects("▄")).toEqual([
      { top: "50%", right: "0", bottom: "0", left: "0" },
    ]);
  });
});
