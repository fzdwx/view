import { describe, expect, test } from "bun:test";
import { normalizeTerminalSelectedLineText } from "./terminalInput";

describe("terminalInput", () => {
  test("removes browser selection newlines inserted between cells on one terminal line", () => {
    expect(normalizeTerminalSelectedLineText("s\nc\nr\ni\np\nt\ns")).toBe(
      "scripts",
    );
  });

  test("removes carriage-return variants inside one terminal line", () => {
    expect(normalizeTerminalSelectedLineText("a\r\nb\rc")).toBe("abc");
  });
});
