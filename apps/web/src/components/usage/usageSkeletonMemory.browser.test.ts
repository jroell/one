import { describe, expect, it, vi } from "vite-plus/test";

import { freshProviderCounts } from "./usageFixtures";

describe("the provider count kept for the skeleton", () => {
  it("is recalled by a new session for the same selection, and not for another", async () => {
    using _counts = freshProviderCounts();
    const first = await import("./usageSkeletonMemory");
    const key = first.selectionKey(new Set(["desk-persist"]), new Set());
    first.rememberProviderCount(key, 5);

    // A reload: a fresh module with an empty in-memory map reads what the last session kept.
    vi.resetModules();
    const reloaded = await import("./usageSkeletonMemory");
    expect(reloaded.recalledProviderCount(key, 4)).toBe(5);
    expect(
      reloaded.recalledProviderCount(
        reloaded.selectionKey(new Set(["other-persist"]), new Set()),
        4,
      ),
    ).toBe(4);
  });

  it("still works when storage is blocked", async () => {
    using _counts = freshProviderCounts();
    const blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      const memory = await import("./usageSkeletonMemory");
      const key = memory.selectionKey(new Set(["desk-blocked"]), new Set());
      memory.rememberProviderCount(key, 3);
      expect(memory.recalledProviderCount(key, 4)).toBe(3);
    } finally {
      blocked.mockRestore();
    }
  });
});
