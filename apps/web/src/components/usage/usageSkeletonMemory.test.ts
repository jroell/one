import { describe, expect, it } from "vite-plus/test";

import { recalledProviderCount, rememberProviderCount, selectionKey } from "./usageSkeletonMemory";

describe("usageSkeletonMemory", () => {
  it("keys a selection by its sorted ids, whatever order they were chosen in", () => {
    expect(selectionKey(null)).toBe("all");
    expect(selectionKey(new Set(["b", "a"]))).toBe(selectionKey(new Set(["a", "b"])));
    expect(selectionKey(new Set(["a"]))).not.toBe(selectionKey(new Set(["a", "b"])));
  });

  it("recalls the last count shown for a selection and falls back for a new one", () => {
    const key = selectionKey(new Set(["desk-memory-test"]));
    expect(recalledProviderCount(key, 4)).toBe(4);
    rememberProviderCount(key, 2);
    expect(recalledProviderCount(key, 4)).toBe(2);
    rememberProviderCount(key, 0);
    expect(recalledProviderCount(key, 4)).toBe(2);
  });
});
