import { describe, expect, test } from "bun:test";
import { terminalRunStyle } from "./terminalRunStyle";

describe("terminalRunStyle", () => {
  test("keeps dim foreground runs fully opaque", () => {
    const style = terminalRunStyle({
      fg: "#00ced1",
      bg: null,
      bold: false,
      dim: true,
      italic: false,
      underline: false,
      inverse: false,
    });

    expect(style.color).toBe("#00ced1");
    expect(style.opacity).toBeUndefined();
  });

  test("keeps dim inverse highlights fully opaque", () => {
    const style = terminalRunStyle({
      fg: "#00ced1",
      bg: "#15141b",
      bold: false,
      dim: true,
      italic: false,
      underline: false,
      inverse: true,
    });

    expect(style.color).toBe("#15141b");
    expect(style.backgroundColor).toBe("#00ced1");
    expect(style.opacity).toBeUndefined();
  });
});
