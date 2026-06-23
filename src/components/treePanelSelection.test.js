import { describe, expect, test } from "bun:test";
import {
  isTreeSelectAllShortcut,
  treeContextFilesForSelection,
} from "./treePanelSelection";

describe("treeContextFilesForSelection", () => {
  test("uses the full file selection when right-clicking a selected file", () => {
    const files = new Map([
      ["src/a.ts", { path: "src/a.ts", status: "modified", unstaged: true }],
      ["src/b.ts", { path: "src/b.ts", status: "modified", staged: true }],
    ]);

    expect(
      treeContextFilesForSelection({
        fileByPath: files,
        itemPath: "src/b.ts",
        selectedPaths: ["src/a.ts", "src/", "src/b.ts"],
      }).map((file) => file.path),
    ).toEqual(["src/a.ts", "src/b.ts"]);
  });

  test("falls back to the clicked file when right-clicking outside the selection", () => {
    const files = new Map([
      ["src/a.ts", { path: "src/a.ts", status: "modified", unstaged: true }],
      ["src/b.ts", { path: "src/b.ts", status: "modified", staged: true }],
    ]);

    expect(
      treeContextFilesForSelection({
        fileByPath: files,
        itemPath: "src/b.ts",
        selectedPaths: ["src/a.ts"],
      }).map((file) => file.path),
    ).toEqual(["src/b.ts"]);
  });

  test("returns no files for directory context menu targets", () => {
    const files = new Map([
      ["src/a.ts", { path: "src/a.ts", status: "modified", unstaged: true }],
    ]);

    expect(
      treeContextFilesForSelection({
        fileByPath: files,
        itemPath: "src/",
        selectedPaths: ["src/a.ts", "src/"],
      }),
    ).toEqual([]);
  });
});

describe("isTreeSelectAllShortcut", () => {
  const baseEvent = {
    altKey: true,
    ctrlKey: false,
    defaultPrevented: false,
    isComposing: false,
    key: "a",
    metaKey: false,
    shiftKey: false,
  };

  test("accepts Alt+A for tree scoped select all", () => {
    expect(isTreeSelectAllShortcut(baseEvent)).toBe(true);
  });

  test("rejects composing and mixed modifier shortcuts", () => {
    expect(
      isTreeSelectAllShortcut({
        ...baseEvent,
        isComposing: true,
      }),
    ).toBe(false);
    expect(
      isTreeSelectAllShortcut({
        ...baseEvent,
        ctrlKey: true,
      }),
    ).toBe(false);
  });
});
