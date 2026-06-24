import type { PerfLogFields } from "./performanceLog";
import type { TerminalFrame } from "./terminalTypes";

export function terminalFramePerfFields(
  frame: TerminalFrame,
  extra?: PerfLogFields,
): PerfLogFields {
  let runs = 0;
  let textChars = 0;
  let nonEmptyLines = 0;

  for (const line of frame.lines) {
    if (line.cells.length > 0) {
      nonEmptyLines += 1;
    }
    runs += line.cells.length;
    for (const run of line.cells) {
      textChars += run.text.length;
    }
  }

  return {
    rows: frame.rows,
    cols: frame.cols,
    lines: frame.lines.length,
    nonEmptyLines,
    runs,
    textChars,
    displayOffset: frame.displayOffset,
    cursorRow: frame.cursorRow,
    cursorCol: frame.cursorCol,
    altScreen: frame.modes.altScreen,
    ...extra,
  };
}
