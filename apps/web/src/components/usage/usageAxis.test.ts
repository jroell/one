import { describe, expect, it } from "vite-plus/test";

import { formatAxisUsd } from "./usageAxis";

describe("formatAxisUsd", () => {
  it.each([
    [0, "0"],
    [0.5, "$0.5"],
    [2, "$2"],
    [250, "$250"],
    [1000, "$1K"],
    [4000, "$4K"],
    [1500, "$1.5K"],
    [2_500_000, "$2.5M"],
  ])("%d reads %s", (value, label) => {
    expect(formatAxisUsd(value, "en-US")).toBe(label);
  });

  it("never prints cents on a round figure", () => {
    expect(formatAxisUsd(3000, "en-US")).not.toContain(".00");
  });
});
