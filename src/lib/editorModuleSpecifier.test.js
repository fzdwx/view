import { describe, expect, test } from "bun:test";
import { moduleSpecifierAtLine } from "./editorModuleSpecifier";

describe("moduleSpecifierAtLine", () => {
  test("returns an import-from module path under the cursor", () => {
    expect(
      moduleSpecifierAtLine(
        'import { api } from "@/lib/api.js";',
        10,
        31,
      ),
    ).toEqual({
      specifier: "@/lib/api.js",
      from: 31,
      to: 43,
    });
  });

  test("returns a require module path under the cursor", () => {
    expect(moduleSpecifierAtLine('const api = require("./api")', 0, 22)).toEqual({
      specifier: "./api",
      from: 21,
      to: 26,
    });
  });

  test("ignores non-import string literals", () => {
    expect(moduleSpecifierAtLine('const label = "api";', 0, 16)).toBeNull();
  });
});
