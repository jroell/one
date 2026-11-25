import { describe, expect, it } from "vite-plus/test";

import { chatOutlineFits, resolveOutlineCurrentIndex } from "./chatOutlineLayout";

describe("resolveOutlineCurrentIndex", () => {
  const tops = [0, 1000, 2000, 3000];
  const long = { tops, viewportHeight: 800, scrollHeight: 3800 };

  it("marks the turn that holds the line a quarter of the way down the view", () => {
    expect(resolveOutlineCurrentIndex({ ...long, scroll: 799 })).toBe(0);
    expect(resolveOutlineCurrentIndex({ ...long, scroll: 800 })).toBe(1);
    expect(resolveOutlineCurrentIndex({ ...long, scroll: 1799 })).toBe(1);
    expect(resolveOutlineCurrentIndex({ ...long, scroll: 1800 })).toBe(2);
  });

  it("marks the first turn when the view starts above every turn", () => {
    expect(resolveOutlineCurrentIndex({ ...long, tops: [400, 1400], scroll: 0 })).toBe(0);
  });

  it("marks the last turn when the whole thread fits or the view is at its end", () => {
    expect(
      resolveOutlineCurrentIndex({ tops, scroll: 0, viewportHeight: 900, scrollHeight: 900 }),
    ).toBe(3);
    expect(resolveOutlineCurrentIndex({ ...long, scroll: 3000 })).toBe(3);
  });

  it("marks nothing when there are no turns", () => {
    expect(
      resolveOutlineCurrentIndex({ tops: [], scroll: 0, viewportHeight: 800, scrollHeight: 800 }),
    ).toBeNull();
  });
});

describe("chatOutlineFits", () => {
  it("needs a gutter of 12rem beside the column and room for three rows", () => {
    expect(chatOutlineFits({ width: 1160, height: 400, rem: 16 })).toBe(true);
    expect(chatOutlineFits({ width: 1159, height: 400, rem: 16 })).toBe(false);
    expect(chatOutlineFits({ width: 1400, height: 383, rem: 16 })).toBe(false);
    expect(chatOutlineFits({ width: 1400, height: 384, rem: 16 })).toBe(true);
  });
});
