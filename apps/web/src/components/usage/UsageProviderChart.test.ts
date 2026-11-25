import { describe, expect, it } from "vite-plus/test";

import type { UsageProviderKind } from "@t3tools/contracts";

import { buildPeriodColumns, chartSeries } from "./UsageProviderChart";

describe("buildPeriodColumns", () => {
  const days = ["2026-08-01", "2026-08-02", "2026-08-03"];
  const byDay = new Map([
    [
      "2026-08-01",
      {
        day: "2026-08-01",
        costUsd: 42,
        totalTokens: 420,
        byProvider: new Map([
          ["codex" as const, { costUsd: 10, totalTokens: 100 }],
          ["claude" as const, { costUsd: 20, totalTokens: 200 }],
          ["pi" as const, { costUsd: 5, totalTokens: 50 }],
          ["muse" as const, { costUsd: 7, totalTokens: 70 }],
        ]),
      },
    ],
    [
      "2026-08-03",
      {
        day: "2026-08-03",
        costUsd: 5,
        totalTokens: 50,
        byProvider: new Map([["claude" as const, { costUsd: 5, totalTokens: 50 }]]),
      },
    ],
  ]);

  it("keeps band values absolute rather than cumulative", () => {
    const [first] = buildPeriodColumns(days, byDay, "cost");

    expect(first?.bands).toEqual([
      { provider: "codex", value: 10 },
      { provider: "claude", value: 20 },
      { provider: "grok", value: 0 },
      { provider: "cursor", value: 0 },
      { provider: "opencode", value: 0 },
      { provider: "antigravity", value: 0 },
      { provider: "pi", value: 5 },
      { provider: "muse", value: 7 },
    ]);
  });
});

describe("chartSeries", () => {
  const day = (entries: Record<string, number>) => {
    const byProvider = new Map(
      Object.entries(entries).map(([provider, tokens]) => [
        provider as UsageProviderKind,
        { costUsd: tokens, totalTokens: tokens },
      ]),
    );
    return { day: "2026-08-01", costUsd: 0, totalTokens: 0, byProvider };
  };
  const columnsFor = (entries: Record<string, number>) =>
    buildPeriodColumns(["2026-08-01"], new Map([["2026-08-01", day(entries)]]), "tokens");
  const none: ReadonlySet<UsageProviderKind> = new Set();
  const all: readonly UsageProviderKind[] = ["codex", "claude", "antigravity", "muse", "grok"];

  it("folds two providers under 1% into one Others band on top, biggest band first", () => {
    const columns = columnsFor({ claude: 400, codex: 590, antigravity: 3, muse: 2, grok: 5 });
    const series = chartSeries(all, columns, none);
    expect(series.map((band) => band.key)).toEqual(["codex", "claude", "others"]);
    expect(series.at(-1)).toMatchObject({
      provider: null,
      providers: ["antigravity", "muse", "grok"],
      total: 10,
    });
  });

  it("keeps a lone minor provider under its own name", () => {
    const columns = columnsFor({ codex: 700, claude: 299, muse: 1 });
    const series = chartSeries(["codex", "claude", "muse"], columns, none);
    expect(series.map((band) => band.key)).toEqual(["codex", "claude", "muse"]);
  });

  it("folds nothing while every provider is still empty", () => {
    const series = chartSeries(all, columnsFor({}), new Set<UsageProviderKind>(["codex"]));
    expect(series.map((band) => band.key).toSorted()).toEqual([...all].toSorted());
  });

  it("marks the Others band as loading when a provider folded into it is", () => {
    const columns = columnsFor({ codex: 990, antigravity: 3, muse: 2 });
    const series = chartSeries(
      ["codex", "antigravity", "muse"],
      columns,
      new Set<UsageProviderKind>(["muse"]),
    );
    expect(series.find((band) => band.key === "others")?.loading).toBe(true);
  });
});
