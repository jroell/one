import { describe, expect, it, vi } from "vite-plus/test";

import { freshProviderCounts } from "./usageFixtures";

describe("the provider count kept for the skeleton", () => {
  it("is recalled by a new session for the same selection, and not for another", async () => {
    using _counts = freshProviderCounts();
    const first = await import("./usageSkeletonMemory");
    const key = first.selectionKey(new Set(["desk-persist"]), new Set(), []);
    first.rememberProviderCount(key, 5);

    // A reload: a fresh module with an empty in-memory map reads what the last session kept.
    vi.resetModules();
    const reloaded = await import("./usageSkeletonMemory");
    expect(reloaded.recalledProviderCount(key, 4)).toBe(5);
    expect(
      reloaded.recalledProviderCount(
        reloaded.selectionKey(new Set(["other-persist"]), new Set(), []),
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
      const key = memory.selectionKey(new Set(["desk-blocked"]), new Set(), []);
      memory.rememberProviderCount(key, 3);
      expect(memory.recalledProviderCount(key, 4)).toBe(3);
    } finally {
      blocked.mockRestore();
    }
  });

  it("does not recall a count kept for another account's machines under the same selection", async () => {
    using _counts = freshProviderCounts();
    const first = await import("./usageSkeletonMemory");
    first.rememberProviderCount(first.selectionKey(null, new Set(), ["account-a-desk"]), 5);

    vi.resetModules();
    const reloaded = await import("./usageSkeletonMemory");
    expect(
      reloaded.recalledProviderCount(reloaded.selectionKey(null, new Set(), ["account-a-desk"]), 4),
    ).toBe(5);
    expect(
      reloaded.recalledProviderCount(reloaded.selectionKey(null, new Set(), ["account-b-mac"]), 4),
    ).toBe(4);
  });

  it("drops what it kept when an environment is removed, and holds only the latest eight", async () => {
    using _counts = freshProviderCounts();
    const memory = await import("./usageSkeletonMemory");
    for (let index = 0; index < 12; index += 1) {
      memory.rememberProviderCount(memory.selectionKey(null, new Set(), [`desk-${index}`]), 3);
    }
    const stored = JSON.parse(localStorage.getItem("one:usage:providers") ?? "[]") as unknown[];
    expect(stored).toHaveLength(8);

    memory.forgetProviderCounts();
    expect(localStorage.getItem("one:usage:providers")).toBeNull();
    expect(memory.recalledProviderCount(memory.selectionKey(null, new Set(), ["desk-11"]), 4)).toBe(
      4,
    );
  });

  it("writes storage only when the count changes", async () => {
    using _counts = freshProviderCounts();
    const memory = await import("./usageSkeletonMemory");
    const write = vi.spyOn(Storage.prototype, "setItem");
    try {
      const key = memory.selectionKey(null, new Set(), ["desk-once"]);
      memory.rememberProviderCount(key, 3);
      memory.rememberProviderCount(key, 3);
      memory.rememberProviderCount(key, 3);
      expect(write).toHaveBeenCalledTimes(1);
      memory.rememberProviderCount(key, 2);
      expect(write).toHaveBeenCalledTimes(2);
    } finally {
      write.mockRestore();
    }
  });
});
