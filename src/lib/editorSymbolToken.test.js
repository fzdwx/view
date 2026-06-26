import { describe, expect, test } from "bun:test";
import { symbolTokenAtLine } from "./editorSymbolToken";

describe("symbolTokenAtLine", () => {
  test("returns a function token under the cursor", () => {
    expect(symbolTokenAtLine("  worker.run()", 20, 29)).toEqual({
      symbol: "run",
      from: 29,
      to: 32,
    });
  });

  test("returns null for whitespace and punctuation", () => {
    expect(symbolTokenAtLine("  worker.run()", 20, 28)).toBeNull();
    expect(symbolTokenAtLine("  worker.run()", 20, 33)).toBeNull();
  });

  test("accepts common JavaScript identifier characters", () => {
    expect(symbolTokenAtLine("  $run_task()", 100, 103)).toEqual({
      symbol: "$run_task",
      from: 102,
      to: 111,
    });
  });
});
