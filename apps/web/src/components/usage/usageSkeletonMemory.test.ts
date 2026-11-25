import { describe, expect, it } from "vite-plus/test";

import { recalledProviderCount, rememberProviderCount, selectionKey } from "./usageSkeletonMemory";

describe("usageSkeletonMemory", () => {
  const none = new Set<string>();

  it("keys a selection by its sorted ids, whatever order they were chosen in", () => {
    expect(selectionKey(null, none)).toContain("all");
    expect(selectionKey(new Set(["b", "a"]), none)).toBe(selectionKey(new Set(["a", "b"]), none));
    expect(selectionKey(new Set(["a"]), none)).not.toBe(selectionKey(new Set(["a", "b"]), none));
  });

  it("keys the provider filter too, in any order", () => {
    const envs = new Set(["desk"]);
    expect(selectionKey(envs, new Set(["codex", "claude"]))).toBe(
      selectionKey(envs, new Set(["claude", "codex"])),
    );
    expect(selectionKey(envs, new Set(["codex"]))).not.toBe(selectionKey(envs, none));
  });

  it("recalls the last count for a selection and falls back for a new one", () => {
    const key = selectionKey(new Set(["desk-memory-test"]), none);
    expect(recalledProviderCount(key, 4)).toBe(4);
    rememberProviderCount(key, 3);
    expect(recalledProviderCount(key, 4)).toBe(3);
  });

  it("remembers a settled zero instead of keeping the older count", () => {
    const key = selectionKey(new Set(["desk-zero-test"]), new Set(["codex"]));
    rememberProviderCount(key, 2);
    rememberProviderCount(key, 0);
    expect(recalledProviderCount(key, 4)).toBe(0);
  });

  it("does not hand one filter's count to another selection of the same machines", () => {
    const envs = new Set(["desk-filter-test"]);
    rememberProviderCount(selectionKey(envs, none), 5);
    expect(recalledProviderCount(selectionKey(envs, new Set(["codex", "claude"])), 4)).toBe(4);
  });
});
