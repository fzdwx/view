import { describe, expect, test } from "bun:test";
import {
  buildTreePanelData,
  cachedTreePanelData,
  clearTreePanelDataCacheForTests,
  emptyTreePanelData,
  storeTreePanelData,
} from "./treePanelData";

describe("treePanelData cache", () => {
  test("keeps prepared tree data across component remount lookups", () => {
    clearTreePanelDataCacheForTests();

    storeTreePanelData("project-signature", emptyTreePanelData);

    expect(cachedTreePanelData("project-signature")).toBe(emptyTreePanelData);
    expect(cachedTreePanelData("missing-signature")).toBeNull();
  });

  test("evicts the least recently used prepared tree data", () => {
    clearTreePanelDataCacheForTests();

    for (let index = 0; index < 6; index += 1) {
      storeTreePanelData(`signature-${index}`, emptyTreePanelData);
    }
    expect(cachedTreePanelData("signature-0")).toBe(emptyTreePanelData);
    storeTreePanelData("signature-6", emptyTreePanelData);

    expect(cachedTreePanelData("signature-1")).toBeNull();
    expect(cachedTreePanelData("signature-0")).toBe(emptyTreePanelData);
  });
});

describe("buildTreePanelData", () => {
  test("keeps Pierre tree directory-first ordering for lexicographically sorted input", () => {
    const data = buildTreePanelData([
      { path: "README.md" },
      { path: "src/a.ts" },
      { path: "src/components/Button.tsx" },
    ]);

    expect(data.paths).toEqual([
      "src/components/Button.tsx",
      "src/a.ts",
      "README.md",
    ]);
  });
});
