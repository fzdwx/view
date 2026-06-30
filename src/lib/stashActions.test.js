import { describe, expect, test } from "bun:test";
import { defaultStashMessage, shortStashHash } from "./stashActions";

describe("stashActions", () => {
  test("builds a compact default message from branch and dirty counts", () => {
    expect(defaultStashMessage("main", 2, 1)).toBe("main: 2 tracked, 1 untracked");
    expect(defaultStashMessage("feature/login", 1, 0)).toBe(
      "feature/login: 1 tracked",
    );
  });

  test("falls back when branch is unavailable", () => {
    expect(defaultStashMessage(null, 0, 0)).toBe("WIP");
  });

  test("shortens stash hashes for compact rows", () => {
    expect(shortStashHash("abcdef1234567890")).toBe("abcdef12");
    expect(shortStashHash("abc")).toBe("abc");
  });
});
