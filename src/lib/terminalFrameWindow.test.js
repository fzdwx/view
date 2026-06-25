import { describe, expect, test } from "bun:test";
import {
  alignTerminalFrameDisplayOffset,
  previewTerminalScrollFrame,
  terminalFrameHasVisibleWindow,
  terminalScrollDeltaForKey,
  terminalVisibleLineAt,
  terminalVisibleLogicalRow,
} from "./terminalFrameWindow";

function line(text) {
  return {
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
  };
}

function frame(overrides = {}) {
  return {
    type: "frame",
    title: null,
    cwd: null,
    rows: 3,
    cols: 20,
    displayOffset: 2,
    lineOffset: -4,
    historySize: 8,
    cursorRow: 4,
    cursorCol: 0,
    cursorVisible: false,
    cursorShape: "block",
    modes: {
      appCursor: false,
      appKeypad: false,
      bracketedPaste: false,
      focusInOut: false,
      mouseReportClick: false,
      mouseDrag: false,
      mouseMotion: false,
      sgrMouse: false,
      utf8Mouse: false,
      altScreen: false,
    },
    lines: [
      line("L-4"),
      line("L-3"),
      line("L-2"),
      line("L-1"),
      line("L0"),
      line("L1"),
      line("L2"),
    ],
    ...overrides,
  };
}

function lineText(value) {
  return value.cells.map((cell) => cell.text).join("");
}

describe("terminalFrameWindow", () => {
  test("maps viewport rows into an overscanned frame", () => {
    const value = frame();

    expect(terminalVisibleLogicalRow(value, 0)).toBe(-2);
    expect(lineText(terminalVisibleLineAt(value, 0))).toBe("L-2");
    expect(lineText(terminalVisibleLineAt(value, 1))).toBe("L-1");
    expect(lineText(terminalVisibleLineAt(value, 2))).toBe("L0");
  });

  test("previews scrollback when the target viewport is already cached", () => {
    const next = previewTerminalScrollFrame(frame(), 1);

    expect(next).not.toBeNull();
    expect(next.displayOffset).toBe(3);
    expect(lineText(terminalVisibleLineAt(next, 0))).toBe("L-3");
    expect(lineText(terminalVisibleLineAt(next, 2))).toBe("L-1");
  });

  test("refuses preview when the target viewport is outside cached lines", () => {
    const value = frame({
      lines: [line("L-2"), line("L-1"), line("L0")],
      lineOffset: -2,
    });

    expect(terminalFrameHasVisibleWindow(value, 3)).toBe(false);
    expect(previewTerminalScrollFrame(value, 1)).toBeNull();
  });

  test("aligns a late backend frame to the current optimistic offset", () => {
    const next = alignTerminalFrameDisplayOffset(frame(), 4);

    expect(next).not.toBeNull();
    expect(next.displayOffset).toBe(4);
    expect(lineText(terminalVisibleLineAt(next, 0))).toBe("L-4");
    expect(lineText(terminalVisibleLineAt(next, 2))).toBe("L-2");
  });

  test("maps terminal scroll shortcuts to clamped line deltas", () => {
    const value = frame({ rows: 6, displayOffset: 2, historySize: 8 });

    expect(terminalScrollDeltaForKey(value, key("PageUp"))).toBe(5);
    expect(terminalScrollDeltaForKey(value, key("PageDown"))).toBe(-2);
    expect(terminalScrollDeltaForKey(value, key("Home"))).toBe(6);
    expect(terminalScrollDeltaForKey(value, key("End"))).toBe(-2);
  });

  test("ignores scroll shortcuts without shift or in alternate screen", () => {
    expect(terminalScrollDeltaForKey(frame(), key("PageUp", { shiftKey: false }))).toBeNull();
    expect(
      terminalScrollDeltaForKey(
        frame({ modes: { ...frame().modes, altScreen: true } }),
        key("PageUp"),
      ),
    ).toBeNull();
  });
});

function key(value, overrides = {}) {
  return {
    altKey: false,
    ctrlKey: false,
    key: value,
    metaKey: false,
    shiftKey: true,
    ...overrides,
  };
}
