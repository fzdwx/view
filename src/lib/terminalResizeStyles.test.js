import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("terminal resize styles", () => {
  test("contains terminal rendering work during panel resize", () => {
    expect(styles).toContain("body.is-resizing-x .terminal-screen");
    expect(styles).toContain("body.is-resizing-y .terminal-screen");
    expect(styles).toContain(".terminal-line");
    expect(styles).toContain(".terminal-run");
    expect(styles).toContain(".terminal-cell");
    expect(styles).toContain("contain: layout paint style");
  });

  test("suppresses resize-only terminal chrome and animation", () => {
    expect(styles).toContain("body.is-resizing-x .terminal-cursor");
    expect(styles).toContain("body.is-resizing-y .terminal-bell-flash");
    expect(styles).toContain("body.is-resizing-x .terminal-scrollback-button");
    expect(styles).toContain("body.is-resizing-y .terminal-scrollback-button");
    expect(styles).toContain("display: none");
    expect(styles).toContain("animation: none");
  });
});
