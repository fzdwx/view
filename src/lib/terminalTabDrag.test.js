import { describe, expect, test } from "bun:test";
import {
  hasTerminalTabDragData,
  readTerminalTabDragData,
  terminalTabDragMime,
  writeTerminalTabDragData,
} from "./terminalTabDrag";

describe("terminalTabDrag", () => {
  test("round-trips terminal tab drag payload", () => {
    const dataTransfer = new FakeDataTransfer();

    writeTerminalTabDragData(dataTransfer, {
      projectPath: "/repo",
      tabId: "terminal-1",
      title: "repo",
    });

    expect(hasTerminalTabDragData(dataTransfer)).toBe(true);
    expect(readTerminalTabDragData(dataTransfer)).toEqual({
      projectPath: "/repo",
      tabId: "terminal-1",
      title: "repo",
    });
  });

  test("returns null for malformed terminal tab payloads", () => {
    const dataTransfer = new FakeDataTransfer();
    dataTransfer.setData(terminalTabDragMime, "{");

    expect(readTerminalTabDragData(dataTransfer)).toBeNull();
  });
});

class FakeDataTransfer {
  constructor() {
    this.values = new Map();
  }

  get types() {
    return Array.from(this.values.keys());
  }

  getData(type) {
    return this.values.get(type) ?? "";
  }

  setData(type, value) {
    this.values.set(type, value);
  }
}
