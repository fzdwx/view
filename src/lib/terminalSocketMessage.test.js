import { describe, expect, test } from "bun:test";
import { parseTerminalSocketMessage } from "./terminalSocketMessage";

describe("terminalSocketMessage", () => {
  test("parses terminal frame cwd", () => {
    const message = parseTerminalSocketMessage(JSON.stringify({
      type: "frame",
      title: "shell",
      cwd: "/repo/packages/app",
      rows: 1,
      cols: 20,
      displayOffset: 0,
      cursorRow: 0,
      cursorCol: 0,
      cursorVisible: true,
      cursorShape: "block",
      modes: {},
      lines: [{ cells: [{ text: "", bold: false, dim: false, italic: false, underline: false, inverse: false }] }],
    }));

    expect(message).toMatchObject({
      type: "frame",
      cwd: "/repo/packages/app",
    });
  });
});
