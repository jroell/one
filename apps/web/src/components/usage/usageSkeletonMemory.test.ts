import { describe, expect, it } from "vite-plus/test";

import {
  pruneSnapshots,
  recalledProviderCount,
  recalledSnapshot,
  rememberProviderCount,
  rememberSnapshot,
  selectionKey,
  usageViewKey,
} from "./usageSkeletonMemory";

describe("usageSkeletonMemory", () => {
  const none = new Set<string>();

  it("keys a selection by its sorted ids, whatever order they were chosen in", () => {
    expect(selectionKey(null, none, [])).toContain("all");
    expect(selectionKey(new Set(["b", "a"]), none, [])).toBe(
      selectionKey(new Set(["a", "b"]), none, []),
    );
    expect(selectionKey(new Set(["a"]), none, [])).not.toBe(
      selectionKey(new Set(["a", "b"]), none, []),
    );
  });

  it("keys the provider filter too, in any order", () => {
    const envs = new Set(["desk"]);
    expect(selectionKey(envs, new Set(["codex", "claude"]), [])).toBe(
      selectionKey(envs, new Set(["claude", "codex"]), []),
    );
    expect(selectionKey(envs, new Set(["codex"]), [])).not.toBe(selectionKey(envs, none, []));
  });

  it("recalls the last count for a selection and falls back for a new one", () => {
    const key = selectionKey(new Set(["desk-memory-test"]), none, []);
    expect(recalledProviderCount(key, 4)).toBe(4);
    rememberProviderCount(key, 3);
    expect(recalledProviderCount(key, 4)).toBe(3);
  });

  it("remembers a settled zero instead of keeping the older count", () => {
    const key = selectionKey(new Set(["desk-zero-test"]), new Set(["codex"]), []);
    rememberProviderCount(key, 2);
    rememberProviderCount(key, 0);
    expect(recalledProviderCount(key, 4)).toBe(0);
  });

  it("does not hand one filter's count to another selection of the same machines", () => {
    const envs = new Set(["desk-filter-test"]);
    rememberProviderCount(selectionKey(envs, none, []), 5);
    expect(recalledProviderCount(selectionKey(envs, new Set(["codex", "claude"]), []), 4)).toBe(4);
  });
});

describe("kept figures", () => {
  const view = (
    ids: readonly string[],
    overrides: { modelFilter?: string; timeZone?: string; generation?: string } = {},
  ) =>
    usageViewKey({
      contributors: ids.map((id) => ({
        id,
        generation: overrides.generation ?? "g1",
        modelFilter: overrides.modelFilter ?? "null",
      })),
      hiddenProviders: new Set(),
      windowDays: 30,
      timeZone: overrides.timeZone ?? "UTC",
      resolution: "day",
    });
  const contributors = (ids: readonly string[], generation = "g1") =>
    ids.map((id) => ({ id, generation, modelFilter: "null" }));

  it("never replays figures that included a machine which is no longer a contributor", () => {
    rememberSnapshot(view(["reopen-A", "reopen-B"]), contributors(["reopen-A", "reopen-B"]), {
      total: 100,
    });
    expect(recalledSnapshot(view(["reopen-B"]))).toBeNull();
  });

  it("does not return the old figures when the same machines come back under a new generation", () => {
    // Credentials replaced, or the machine removed and paired again: same ids, new generation.
    rememberSnapshot(view(["gen-A", "gen-B"]), contributors(["gen-A", "gen-B"]), { total: 100 });
    expect(recalledSnapshot(view(["gen-A", "gen-B"], { generation: "g2" }))).toBeNull();
    expect(recalledSnapshot(view(["gen-A", "gen-B"]))).toEqual({ total: 100 });
  });

  it("evicts the views of an environment that was removed or replaced, keeping the others", () => {
    rememberSnapshot(view(["prune-A", "prune-B"]), contributors(["prune-A", "prune-B"]), { v: 1 });
    rememberSnapshot(view(["prune-B"]), contributors(["prune-B"]), { v: 2 });

    // A is gone from the list: its view goes, B's stays.
    pruneSnapshots(new Map([["prune-B", "g1"]]));
    expect(recalledSnapshot(view(["prune-A", "prune-B"]))).toBeNull();
    expect(recalledSnapshot(view(["prune-B"]))).toEqual({ v: 2 });

    // B replaced: its view goes too, even if the old key is asked for again.
    pruneSnapshots(new Map([["prune-B", "g2"]]));
    expect(recalledSnapshot(view(["prune-B"]))).toBeNull();
  });

  it("keys the model filter and the time zone, so another query never replays", () => {
    rememberSnapshot(view(["query-A"]), contributors(["query-A"]), { total: 1 });
    expect(recalledSnapshot(view(["query-A"], { modelFilter: '{"only":"x"}' }))).toBeNull();
    expect(recalledSnapshot(view(["query-A"], { timeZone: "Asia/Tokyo" }))).toBeNull();
    expect(recalledSnapshot(view(["query-A"]))).toEqual({ total: 1 });
  });

  it("holds only the most recent views", () => {
    for (let index = 0; index < 8; index += 1) {
      rememberSnapshot(view([`bound-${index}`]), contributors([`bound-${index}`]), { index });
    }
    expect(recalledSnapshot(view(["bound-0"]))).toBeNull();
    expect(recalledSnapshot(view(["bound-1"]))).toBeNull();
    expect(recalledSnapshot(view(["bound-7"]))).toEqual({ index: 7 });
  });
});
