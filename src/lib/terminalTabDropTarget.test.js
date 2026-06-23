import { describe, expect, test } from "bun:test";
import { writeTerminalTabDragData } from "./terminalTabDrag";
import { acceptsTerminalTabEditorDrop } from "./terminalTabDropTarget";

describe("terminalTabDropTarget", () => {
  test("accepts terminal tabs anywhere inside an editor pane", () => {
    const dataTransfer = new FakeDataTransfer();
    writeTerminalTabDragData(dataTransfer, {
      projectPath: "/repo",
      tabId: "terminal-1",
      title: "repo",
    });

    expect(
      acceptsTerminalTabEditorDrop({
        dataTransfer,
        isWithinEditorPane: true,
      }),
    ).toBe(true);
  });

  test("rejects terminal tab drops outside editor panes", () => {
    const dataTransfer = new FakeDataTransfer();
    writeTerminalTabDragData(dataTransfer, {
      projectPath: "/repo",
      tabId: "terminal-1",
      title: "repo",
    });

    expect(
      acceptsTerminalTabEditorDrop({
        dataTransfer,
        isWithinEditorPane: false,
      }),
    ).toBe(false);
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
