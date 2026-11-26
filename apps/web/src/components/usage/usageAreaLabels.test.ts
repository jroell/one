import { describe, expect, it } from "vite-plus/test";

import { spreadLabels } from "./usageAreaLabels";

describe("spreadLabels", () => {
  it("leaves labels that already have room where they are", () => {
    expect(spreadLabels([20, 100, 200], 18, 260)).toEqual([20, 100, 200]);
  });

  it("moves labels that would touch apart by the gap, keeping their order", () => {
    const placed = spreadLabels([100, 104, 106], 18, 260);
    expect(placed).toEqual([100, 118, 136]);
  });

  it("keeps the order of the series even when they are given out of order", () => {
    const placed = spreadLabels([106, 100, 104], 18, 260);
    expect(placed).toEqual([136, 100, 118]);
  });

  it("pulls a stack that would run off the bottom back inside the plot", () => {
    const placed = spreadLabels([250, 252, 255], 18, 260);
    expect(placed).toEqual([215, 233, 251]);
    expect(Math.max(...placed)).toBeLessThanOrEqual(260 - 9);
  });

  it("keeps a label at the very top clear of the edge", () => {
    expect(spreadLabels([0], 18, 260)).toEqual([9]);
  });
});
