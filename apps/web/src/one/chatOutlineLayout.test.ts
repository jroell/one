import { describe, expect, it } from "vite-plus/test";

import { chatOutlineFits, resolveOutlineCurrentIndex } from "./chatOutlineLayout";

describe("resolveOutlineCurrentIndex", () => {
  const tops = [0, 1000, 2000, 3000];
  const long = { count: tops.length, topAt: (index: number) => tops[index]!, viewportHeight: 800 };
  const reading = (scroll: number) => resolveOutlineCurrentIndex({ ...long, scroll, atEnd: false });

  it("marks the turn that holds the line a quarter of the way down the view", () => {
    expect(reading(799)).toBe(0);
    expect(reading(800)).toBe(1);
    expect(reading(1799)).toBe(1);
    expect(reading(1800)).toBe(2);
  });

  it("marks the first turn when the view starts above every turn", () => {
    const later = [400, 1400];
    expect(
      resolveOutlineCurrentIndex({
        ...long,
        count: 2,
        topAt: (index) => later[index]!,
        scroll: 0,
        atEnd: false,
      }),
    ).toBe(0);
  });

  it("marks the last turn when the caller reports the view at its physical end", () => {
    expect(resolveOutlineCurrentIndex({ ...long, scroll: 0, atEnd: true })).toBe(3);
  });

  it("marks the last turn at the physical end of a thread with a short final turn, though the reading line sits above it", () => {
    // 3,800 px of content, an 800 px view and a 16 px header put the header-relative scroll at 2,984.
    const shortLast = [0, 1000, 2000, 3500];
    const input = { count: 4, topAt: (index: number) => shortLast[index]!, viewportHeight: 800 };
    expect(resolveOutlineCurrentIndex({ ...input, scroll: 2984, atEnd: false })).toBe(2);
    expect(resolveOutlineCurrentIndex({ ...input, scroll: 2984, atEnd: true })).toBe(3);
  });

  it("marks nothing when there are no turns", () => {
    expect(
      resolveOutlineCurrentIndex({
        count: 0,
        topAt: () => 0,
        scroll: 0,
        viewportHeight: 800,
        atEnd: true,
      }),
    ).toBeNull();
  });

  it("reads a handful of turn tops, not every turn, to find the turn in a long thread", () => {
    const count = 5000;
    const reads: number[] = [];
    const index = resolveOutlineCurrentIndex({
      count,
      topAt: (at) => {
        reads.push(at);
        return at * 1000;
      },
      scroll: 2_500_000,
      viewportHeight: 800,
      atEnd: false,
    });
    expect(index).toBe(2500);
    expect(reads.length).toBeLessThanOrEqual(14);
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
