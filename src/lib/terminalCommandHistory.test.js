import { describe, expect, test } from "bun:test";
import {
  findTerminalFrameText,
  terminalCommandHistoryReducer,
} from "./terminalCommandHistory";

function frame({
  commandStatus = null,
  cwd = "/repo",
  lineOffset = 0,
  lines = [""],
}) {
  return {
    type: "frame",
    title: "shell",
    cwd,
    oscCwd: cwd,
    commandStatus,
    rows: lines.length,
    cols: 80,
    displayOffset: 0,
    lineOffset,
    historySize: Math.max(0, -lineOffset),
    cursorRow: Math.max(0, lines.length - 1),
    cursorCol: 0,
    cursorVisible: true,
    cursorShape: "block",
    modes: {},
    lines: lines.map((text) => ({
      cells: [
        {
          text,
          bold: false,
          dim: false,
          italic: false,
          underline: false,
          inverse: false,
        },
      ],
    })),
  };
}

describe("terminalCommandHistory", () => {
  test("records command boundaries from running to finished frames", () => {
    const initial = terminalCommandHistoryReducer(undefined, frame({
      commandStatus: { phase: "prompt", exitCode: null },
      lineOffset: 10,
      lines: ["% "],
    }));
    const running = terminalCommandHistoryReducer(initial, frame({
      commandStatus: { phase: "running", exitCode: null },
      lineOffset: 10,
      lines: ["% bun test"],
    }));
    const finished = terminalCommandHistoryReducer(running, frame({
      commandStatus: { phase: "finished", exitCode: 0 },
      lineOffset: 10,
      lines: ["% bun test", "pass"],
    }));

    expect(finished.commands).toHaveLength(1);
    expect(finished.commands[0]).toMatchObject({
      phase: "finished",
      exitCode: 0,
      cwd: "/repo",
      lineOffset: 10,
      text: "% bun test",
    });
  });

  test("finds matches in serialized terminal frame text", () => {
    const matches = findTerminalFrameText(
      frame({
        lineOffset: -2,
        lines: ["first line", "run tests", "tests passed"],
      }),
      "tests",
    );

    expect(matches).toEqual([
      { logicalRow: -1, row: 1, column: 4, length: 5 },
      { logicalRow: 0, row: 2, column: 0, length: 5 },
    ]);
  });
});
