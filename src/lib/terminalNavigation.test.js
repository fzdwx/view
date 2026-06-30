import { describe, expect, test } from "bun:test";
import {
  terminalInternalLinkEvent,
  terminalLinkSegments,
} from "./terminalNavigation";

describe("terminalNavigation", () => {
  test("links project-relative file locations and commit hashes", () => {
    const segments = terminalLinkSegments(
      "src/App.tsx:1031 fixed in abcdef1",
      { cwd: "/repo", projectPath: "/repo" },
    );

    expect(segments).toEqual([
      {
        link: {
          columnNumber: null,
          kind: "file",
          lineNumber: 1031,
          path: "src/App.tsx",
          projectPath: "/repo",
        },
        text: "src/App.tsx:1031",
      },
      { text: " fixed in " },
      {
        link: { hash: "abcdef1", kind: "commit", projectPath: "/repo" },
        text: "abcdef1",
      },
    ]);
  });

  test("normalizes absolute and cwd-relative file locations into project paths", () => {
    expect(
      terminalLinkSegments("/repo/src/App.tsx:12:3", {
        cwd: "/repo",
        projectPath: "/repo",
      }),
    ).toEqual([
      {
        link: {
          columnNumber: 3,
          kind: "file",
          lineNumber: 12,
          path: "src/App.tsx",
          projectPath: "/repo",
        },
        text: "/repo/src/App.tsx:12:3",
      },
    ]);

    expect(
      terminalLinkSegments("src/index.ts:5", {
        cwd: "/repo/packages/app",
        projectPath: "/repo",
      }),
    ).toEqual([
      {
        link: {
          columnNumber: null,
          kind: "file",
          lineNumber: 5,
          path: "packages/app/src/index.ts",
          projectPath: "/repo",
        },
        text: "src/index.ts:5",
      },
    ]);
  });

  test("exports a stable event name for app-level navigation", () => {
    expect(terminalInternalLinkEvent).toBe("view:terminal-internal-link");
  });
});
