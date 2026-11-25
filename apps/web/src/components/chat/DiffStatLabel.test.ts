import { describe, expect, it } from "vite-plus/test";

import { formatCompactDiffCount, isLikelyBinaryDiffFile } from "./DiffStatLabel";

describe("formatCompactDiffCount", () => {
  it("promotes counts when rounding reaches the next suffix", () => {
    expect(formatCompactDiffCount(999_499)).toBe("999k");
    expect(formatCompactDiffCount(999_500)).toBe("1m");
    expect(formatCompactDiffCount(999_499_999)).toBe("999m");
    expect(formatCompactDiffCount(999_500_000)).toBe("1b");
  });
});

describe("isLikelyBinaryDiffFile", () => {
  it("flags zero-line stats on binary file types only", () => {
    expect(isLikelyBinaryDiffFile(".github/readme/logo.png", 0, 0)).toBe(true);
    expect(isLikelyBinaryDiffFile("assets/font.woff2", 0, 0)).toBe(true);
    expect(isLikelyBinaryDiffFile("assets/logo.png", 3, 0)).toBe(false);
    expect(isLikelyBinaryDiffFile("src/empty.ts", 0, 0)).toBe(false);
    expect(isLikelyBinaryDiffFile("dmg-background.svg", 0, 0)).toBe(false);
  });
});
