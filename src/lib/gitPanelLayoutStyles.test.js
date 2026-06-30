import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("git panel layout styles", () => {
  test("keeps repository state shelves compact above refs", () => {
    const branchPanelContentRule =
      styles.match(/\.branch-panel-content\s*\{[^}]*\}/)?.[0] ?? "";
    const repositoryRefsPanelRule =
      styles.match(/\.repository-refs-panel\s*\{[^}]*\}/)?.[0] ?? "";

    expect(branchPanelContentRule).toContain(
      "grid-template-rows: auto auto auto minmax(0, 1fr);",
    );
    expect(styles).not.toContain(".repository-state-panel");
    expect(repositoryRefsPanelRule).toContain(
      "grid-template-rows: auto minmax(0, 1fr);",
    );
  });
});
