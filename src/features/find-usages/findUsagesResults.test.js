import { describe, expect, test } from "bun:test";
import {
  findUsagesResultKey,
  groupFindUsagesResults,
} from "./findUsagesResults";

describe("findUsagesResults", () => {
  test("groups contiguous results by file path", () => {
    const groups = groupFindUsagesResults([
      result("src/a.ts", 3),
      result("src/a.ts", 8),
      result("src/b.ts", 1),
    ]);

    expect(groups).toEqual([
      {
        path: "src/a.ts",
        startIndex: 0,
        results: [result("src/a.ts", 3), result("src/a.ts", 8)],
      },
      {
        path: "src/b.ts",
        startIndex: 2,
        results: [result("src/b.ts", 1)],
      },
    ]);
  });

  test("includes path, line and ranges in result key", () => {
    expect(findUsagesResultKey(result("src/a.ts", 3), 4)).toBe(
      "src/a.ts:3:1-4:4",
    );
  });
});

function result(path, lineNumber) {
  return {
    path,
    score: 0,
    lineNumber,
    lineText: "callThing()",
    contextBefore: [],
    contextAfter: [],
    matchRanges: [[1, 4]],
  };
}
