import { describe, expect, test } from "bun:test";

describe("useRepositoryWorkspaceData module boundary", () => {
  test("keeps preview-pane queries out of the repository workspace data hook", async () => {
    const source = await Bun.file(
      "src/hooks/useRepositoryWorkspaceData.ts",
    ).text();

    expect(source).not.toContain("useRepositoryPreviewData");
    expect(source).not.toContain("fileBlameQuery");
    expect(source).not.toContain("fileDiffQuery");
    expect(source).not.toContain("fileWorktreeDiffQuery");
  });
});
