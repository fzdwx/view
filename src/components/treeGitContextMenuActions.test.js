import { describe, expect, test } from "bun:test";
import { buildGitContextMenuActions } from "./treeGitContextMenuActions";

function createContext() {
  let closed = false;
  return {
    context: {
      close: () => {
        closed = true;
      },
    },
    wasClosed: () => closed,
  };
}

describe("buildGitContextMenuActions", () => {
  test("builds batch stage and unstage actions for mixed selections", () => {
    const stageCalls = [];
    const unstageCalls = [];
    const { context, wasClosed } = createContext();
    const actions = buildGitContextMenuActions(
      [
        { path: "src/unstaged.ts", status: "modified", unstaged: true },
        { path: "src/staged.ts", status: "modified", staged: true },
      ],
      {
        canRun: true,
        pendingKind: null,
        pendingPath: null,
        pendingTitle: null,
        onStageFiles: (paths) => {
          stageCalls.push([...paths]);
        },
        onUnstageFiles: (paths) => {
          unstageCalls.push([...paths]);
        },
      },
      context,
    );

    expect(actions.map((action) => action.label)).toEqual([
      "Stage selected",
      "Unstage selected",
    ]);

    actions[0]?.onSelect();
    expect(stageCalls).toEqual([["src/unstaged.ts"]]);
    expect(wasClosed()).toBe(true);

    actions[1]?.onSelect();
    expect(unstageCalls).toEqual([["src/staged.ts"]]);
  });
});
