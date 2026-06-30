import { describe, expect, test } from "bun:test";
import { treeContentAlignmentCss } from "./treePanelTheme";

describe("treeContentAlignmentCss", () => {
  test("contains the heavy tree surface while a panel resize is active", () => {
    expect(treeContentAlignmentCss).toContain(
      ":host([data-view-panel-resizing='true'])",
    );
    expect(treeContentAlignmentCss).toContain(
      "[data-file-tree-virtualized-scroll='true']",
    );
    expect(treeContentAlignmentCss).toContain(
      "[data-file-tree-virtualized-list='true']",
    );
    expect(treeContentAlignmentCss).toContain("[data-type='item']");
    expect(treeContentAlignmentCss).toContain("contain: layout paint style");
  });

  test("suppresses resize-only tree chrome that causes extra paint work", () => {
    expect(treeContentAlignmentCss).toContain(
      "[data-file-tree-sticky-overlay]",
    );
    expect(treeContentAlignmentCss).toContain("[data-type='context-menu-anchor']");
    expect(treeContentAlignmentCss).toContain("[data-truncate-marker]");
    expect(treeContentAlignmentCss).toContain("display: none !important");
  });
});
