import { describe, expect, test } from "bun:test";
import { resetTreeModelWithPreparedInput } from "./treePanelModelReset";

describe("resetTreeModelWithPreparedInput", () => {
  test("uses the prepared-input-only reset path", () => {
    let resetArgs = null;
    const model = {
      resetPaths(paths, options) {
        resetArgs = { paths, options };
      },
    };
    const preparedInput = { paths: ["src/file.ts"] };

    resetTreeModelWithPreparedInput(model, preparedInput, ["src/"]);

    expect(resetArgs).toEqual({
      paths: undefined,
      options: {
        preparedInput,
        initialExpandedPaths: ["src/"],
      },
    });
  });
});
