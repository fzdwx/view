import { describe, expect, test } from "bun:test";
import {
  copyRelativePathText,
  directoryPathForNewChild,
  ignorePatternForTreePath,
  projectTreeContextAvailability,
} from "./projectTreeActions";

describe("projectTreeActions", () => {
  test("uses clicked directories as new child parents", () => {
    expect(directoryPathForNewChild("directory", "src/features")).toBe("src/features");
    expect(directoryPathForNewChild("file", "src/main.ts")).toBe("src");
    expect(directoryPathForNewChild("file", "README.md")).toBeNull();
  });

  test("normalizes .gitignore patterns for files and directories", () => {
    expect(ignorePatternForTreePath("dist", "directory")).toBe("dist/");
    expect(ignorePatternForTreePath("src\\generated\\", "directory")).toBe("src/generated/");
    expect(ignorePatternForTreePath("/debug.log", "file")).toBe("debug.log");
  });

  test("normalizes relative path copy text", () => {
    expect(copyRelativePathText("/src\\main.ts")).toBe("src/main.ts");
  });

  test("enables directory operations without file-only Git actions", () => {
    expect(projectTreeContextAvailability("directory")).toMatchObject({
      canCreateFolder: true,
      canDelete: true,
      canIgnore: true,
      canRename: true,
      canReveal: true,
    });
    expect(projectTreeContextAvailability("file")).toMatchObject({
      canCreateFolder: true,
      canDelete: true,
      canIgnore: true,
      canRename: true,
      canReveal: true,
    });
  });
});
