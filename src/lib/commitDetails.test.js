import { describe, expect, test } from "bun:test";
import {
  commitDetailsCopyText,
  commitParentLabels,
  commitRefLabel,
  commitSignatureLabel,
  commitCompareLabel,
} from "./commitDetails";

describe("commitDetails", () => {
  test("formats parent hashes as short labels", () => {
    expect(commitParentLabels([
      "1234567890abcdef",
      "fedcba0987654321",
    ])).toEqual(["1234567", "fedcba0"]);
  });

  test("formats refs without Git namespace prefixes", () => {
    expect(commitRefLabel("refs/tags/v1.0.0")).toBe("v1.0.0");
    expect(commitRefLabel("refs/heads/main")).toBe("main");
    expect(commitRefLabel("refs/remotes/origin/main")).toBe("origin/main");
  });

  test("formats signature status labels", () => {
    expect(commitSignatureLabel({ status: "valid", summary: "Good signature" })).toBe(
      "Verified signature",
    );
    expect(commitSignatureLabel({ status: "unsigned", summary: "" })).toBe(
      "Unsigned commit",
    );
    expect(commitSignatureLabel({ status: "unknown", summary: "" })).toBe(
      "Signature unknown",
    );
  });

  test("uses full hash for copy and compare labels", () => {
    const details = {
      hash: "abcdef1234567890",
      compareBase: "1234567890abcdef",
    };

    expect(commitDetailsCopyText(details)).toBe("abcdef1234567890");
    expect(commitCompareLabel(details)).toBe("Compare 1234567..abcdef1");
  });
});
