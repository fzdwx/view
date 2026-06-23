import { describe, expect, test } from "bun:test";
import {
  activatePreviewPane,
  activePreviewPane,
  activePreviewPaneTab,
  closePreviewPaneTab,
  createPreviewPaneLayout,
  movePreviewPaneTabPath,
  openPreviewPaneTab,
  primaryPreviewPaneId,
  splitPreviewPaneTab,
} from "./previewPanes";

const fileA = {
  id: "file:worktree:src/a.ts",
  mode: "file",
  path: "src/a.ts",
  commit: null,
};

const fileB = {
  id: "file:worktree:src/b.ts",
  mode: "file",
  path: "src/b.ts",
  commit: null,
};

const fileRenamed = {
  id: "file:worktree:src/renamed.ts",
  mode: "file",
  path: "src/renamed.ts",
  commit: null,
};

describe("previewPanes", () => {
  test("splits the active tab into a right pane", () => {
    const opened = openPreviewPaneTab(
      createPreviewPaneLayout(),
      primaryPreviewPaneId,
      fileA,
      null,
    );

    const split = splitPreviewPaneTab(
      opened,
      primaryPreviewPaneId,
      fileA.id,
      "right",
      "preview-pane-2",
    );

    expect(split.splitDirection).toBe("right");
    expect(split.panes).toHaveLength(2);
    expect(split.activePaneId).toBe("preview-pane-2");
    expect(split.panes[1]?.tabs).toEqual([fileA]);
  });

  test("splits the same tab into a new pane each time", () => {
    const opened = openPreviewPaneTab(
      createPreviewPaneLayout(),
      primaryPreviewPaneId,
      fileA,
      null,
    );
    const splitOnce = splitPreviewPaneTab(
      opened,
      primaryPreviewPaneId,
      fileA.id,
      "right",
      "preview-pane-2",
    );

    const splitTwice = splitPreviewPaneTab(
      splitOnce,
      primaryPreviewPaneId,
      fileA.id,
      "right",
      "preview-pane-3",
    );

    expect(splitTwice.splitDirection).toBe("right");
    expect(splitTwice.panes.map((pane) => pane.id)).toEqual([
      primaryPreviewPaneId,
      "preview-pane-3",
      "preview-pane-2",
    ]);
    expect(splitTwice.activePaneId).toBe("preview-pane-3");
    expect(splitTwice.panes[1]?.tabs).toEqual([fileA]);
    expect(splitTwice.tree).toEqual({
      kind: "split",
      direction: "right",
      children: [
        { kind: "pane", paneId: primaryPreviewPaneId },
        { kind: "pane", paneId: "preview-pane-3" },
        { kind: "pane", paneId: "preview-pane-2" },
      ],
    });
  });

  test("nests a down split inside the selected right pane", () => {
    const opened = openPreviewPaneTab(
      createPreviewPaneLayout(),
      primaryPreviewPaneId,
      fileA,
      null,
    );
    const splitRight = splitPreviewPaneTab(
      opened,
      primaryPreviewPaneId,
      fileA.id,
      "right",
      "preview-pane-2",
    );

    const splitDown = splitPreviewPaneTab(
      splitRight,
      "preview-pane-2",
      fileA.id,
      "down",
      "preview-pane-3",
    );

    expect(splitDown.splitDirection).toBe("right");
    expect(splitDown.panes).toHaveLength(3);
    expect(splitDown.panes[2]?.id).toBe("preview-pane-3");
    expect(splitDown.activePaneId).toBe("preview-pane-3");
    expect(splitDown.tree).toEqual({
      kind: "split",
      direction: "right",
      children: [
        { kind: "pane", paneId: primaryPreviewPaneId },
        {
          kind: "split",
          direction: "down",
          children: [
            { kind: "pane", paneId: "preview-pane-2" },
            { kind: "pane", paneId: "preview-pane-3" },
          ],
        },
      ],
    });
  });

  test("opens new tabs in the active split pane", () => {
    const opened = openPreviewPaneTab(
      createPreviewPaneLayout(),
      primaryPreviewPaneId,
      fileA,
      null,
    );
    const split = splitPreviewPaneTab(
      opened,
      primaryPreviewPaneId,
      fileA.id,
      "down",
      "preview-pane-2",
    );
    const next = openPreviewPaneTab(split, split.activePaneId, fileB, null);
    const pane = activePreviewPane(next) ?? next.panes[0];

    expect(next.splitDirection).toBe("down");
    expect(activePreviewPaneTab(pane)).toEqual(fileB);
    expect(next.panes[1]?.tabs).toEqual([fileA, fileB]);
  });

  test("closing the last tab in a split pane removes that pane", () => {
    const opened = openPreviewPaneTab(
      createPreviewPaneLayout(),
      primaryPreviewPaneId,
      fileA,
      null,
    );
    const split = splitPreviewPaneTab(
      opened,
      primaryPreviewPaneId,
      fileA.id,
      "right",
      "preview-pane-2",
    );

    const next = closePreviewPaneTab(split, "preview-pane-2", fileA.id);

    expect(next.splitDirection).toBeNull();
    expect(next.panes).toHaveLength(1);
    expect(next.activePaneId).toBe(primaryPreviewPaneId);
  });

  test("renaming an inactive tab keeps the active tab unchanged", () => {
    const openedA = openPreviewPaneTab(
      createPreviewPaneLayout(),
      primaryPreviewPaneId,
      fileA,
      null,
    );
    const openedB = openPreviewPaneTab(openedA, primaryPreviewPaneId, fileB, null);
    const reactivatedB = activatePreviewPane(openedB, primaryPreviewPaneId);

    const renamed = movePreviewPaneTabPath(
      reactivatedB,
      fileA.path,
      fileRenamed,
    );

    expect(renamed.panes[0]?.activeTabId).toBe(fileB.id);
    expect(renamed.panes[0]?.tabs).toEqual([fileRenamed, fileB]);
  });
});
