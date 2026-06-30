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
      lineOffset: 0,
      historySize: 0,
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
      lineOffset: 0,
      historySize: 0,
    });
  });

  test("parses terminal OSC command status and cwd metadata", () => {
    const message = parseTerminalSocketMessage(JSON.stringify({
      type: "frame",
      title: "shell",
      cwd: "/repo",
      oscCwd: "/repo",
      commandStatus: { phase: "finished", exitCode: 2 },
      rows: 1,
      cols: 20,
      displayOffset: 0,
      lineOffset: 0,
      historySize: 0,
      cursorRow: 0,
      cursorCol: 0,
      cursorVisible: true,
      cursorShape: "block",
      modes: {},
      lines: [{ cells: [] }],
    }));

    expect(message).toMatchObject({
      type: "frame",
      cwd: "/repo",
      oscCwd: "/repo",
      commandStatus: { phase: "finished", exitCode: 2 },
    });
  });

  test("defaults scrollback window fields for older terminal frames", () => {
    const message = parseTerminalSocketMessage(JSON.stringify({
      type: "frame",
      title: "shell",
      rows: 2,
      cols: 20,
      displayOffset: 3,
      cursorRow: 0,
      cursorCol: 0,
      cursorVisible: false,
      cursorShape: "block",
      modes: {},
      lines: [{ cells: [] }, { cells: [] }],
    }));

    expect(message).toMatchObject({
      type: "frame",
      lineOffset: -3,
      historySize: 3,
    });
  });

  test("parses terminal run width metadata", () => {
    const message = parseTerminalSocketMessage(JSON.stringify({
      type: "frame",
      title: "shell",
      rows: 1,
      cols: 6,
      displayOffset: 0,
      cursorRow: 0,
      cursorCol: 0,
      cursorVisible: false,
      cursorShape: "block",
      modes: {},
      lines: [
        {
          cells: [
            {
              text: "A界",
              columns: 3,
              simpleAscii: false,
              graphemes: [
                { text: "A", columns: 1 },
                { text: "界", columns: 2 },
              ],
              bold: false,
              dim: false,
              italic: false,
              underline: false,
              inverse: false,
            },
          ],
        },
      ],
    }));

    expect(message).toMatchObject({
      type: "frame",
      lines: [
        {
          cells: [
            {
              text: "A界",
              columns: 3,
              simpleAscii: false,
              graphemes: [
                { text: "A", columns: 1 },
                { text: "界", columns: 2 },
              ],
            },
          ],
        },
      ],
    });
  });
});
