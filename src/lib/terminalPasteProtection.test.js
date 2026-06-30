import { describe, expect, test } from "bun:test";
import { shouldConfirmTerminalPaste } from "./terminalPasteProtection";

describe("terminalPasteProtection", () => {
  test("allows short single-line paste without confirmation", () => {
    expect(shouldConfirmTerminalPaste("git status")).toBe(false);
  });

  test("confirms multiline and large terminal paste", () => {
    expect(shouldConfirmTerminalPaste("echo one\necho two")).toBe(true);
    expect(shouldConfirmTerminalPaste("x".repeat(2001))).toBe(true);
  });
});
