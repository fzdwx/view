import { describe, expect, test } from "bun:test";

describe("useRepositoryRemotePolling module boundary", () => {
  test("does not refetch project files after remote-only fetches", async () => {
    const source = await Bun.file("src/hooks/useRepositoryRemotePolling.ts").text();

    expect(source).not.toContain("refetchProjectFiles");
  });
});
