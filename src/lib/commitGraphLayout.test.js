import { describe, expect, test } from "bun:test";
import { buildCommitGraph } from "./commitGraph";
import {
  commitGraphWidthRows,
  getCommitGraphColumnWidth,
} from "./commitGraphLayout";

const commit = (hash, parents = [], subject = hash) => ({
  hash,
  shortHash: hash.slice(0, 7),
  subject,
  author: "Like",
  date: "2026-06-25T00:00:00Z",
  parents,
  refs: [],
  tracking: null,
});

describe("commit graph layout", () => {
  test("uses visible rows for graph width while commit search is active", () => {
    const fullRows = buildCommitGraph([
      commit("merge", ["left", "right"], "wide graph"),
      commit("left", ["base"]),
      commit("right", ["base"]),
      commit("base"),
    ]);
    const filteredRows = buildCommitGraph([commit("right", [], "result")]);

    const fullWidth = getCommitGraphColumnWidth(fullRows);
    const filteredWidth = getCommitGraphColumnWidth(filteredRows);

    expect(fullWidth).toBeGreaterThan(filteredWidth);
    expect(
      getCommitGraphColumnWidth(
        commitGraphWidthRows({
          filteredRows,
          fullRows,
          hasFilter: true,
        }),
      ),
    ).toBe(filteredWidth);
  });

  test("keeps full history graph width when commit search is empty", () => {
    const fullRows = buildCommitGraph([
      commit("merge", ["left", "right"], "wide graph"),
      commit("left", ["base"]),
      commit("right", ["base"]),
      commit("base"),
    ]);
    const filteredRows = buildCommitGraph([commit("right")]);

    expect(
      getCommitGraphColumnWidth(
        commitGraphWidthRows({
          filteredRows,
          fullRows,
          hasFilter: false,
        }),
      ),
    ).toBe(getCommitGraphColumnWidth(fullRows));
  });
});
