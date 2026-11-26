import type { ModelTotals } from "@t3tools/shared/usageMerge";
import { describe, expect, it } from "vite-plus/test";

import {
  cacheHitRate,
  costPerMillionTokens,
  leadingProvider,
  wholePercent,
} from "./usageBreakdown";

const model = (
  name: string,
  totalTokens: number,
  costUsd: number,
  overrides: Partial<ModelTotals> = {},
): ModelTotals => ({
  model: name,
  provider: "codex",
  costUsd,
  totalTokens,
  tokens: {
    uncachedInputTokens: totalTokens,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  },
  records: 1,
  unpricedRecords: 0,
  unpricedTokens: 0,
  costShare: 0,
  tokenShare: 0,
  ...overrides,
});

describe("model rates", () => {
  it("counts cache writes as misses and leaves unpriced tokens out of $/1M", () => {
    const mixed = model("mixed", 4_000_000, 6, {
      tokens: {
        uncachedInputTokens: 1_000_000,
        cachedInputTokens: 1_000_000,
        cacheCreationTokens: 2_000_000,
        outputTokens: 0,
        reasoningTokens: 0,
      },
      records: 4,
      unpricedRecords: 1,
      unpricedTokens: 1_000_000,
    });

    expect(cacheHitRate(mixed)).toBe(0.25);
    expect(costPerMillionTokens(mixed)).toBe(2);
    expect(costPerMillionTokens({ ...mixed, unpricedRecords: 4 })).toBeNull();
  });
});

describe("leadingProvider", () => {
  const providers = [
    { provider: "codex", costShare: 0.531, tokenShare: 0.567 },
    { provider: "claude", costShare: 0.462, tokenShare: 0.429 },
  ] as const;

  it("names the provider with the most of the chosen metric, which can differ by metric", () => {
    expect(leadingProvider(providers, "tokens")).toEqual({ provider: "codex", share: 0.567 });
    const swapped = [
      { provider: "codex", costShare: 0.3, tokenShare: 0.6 },
      { provider: "claude", costShare: 0.7, tokenShare: 0.4 },
    ] as const;
    expect(leadingProvider(swapped, "cost")?.provider).toBe("claude");
  });

  it("names nobody when nothing was used", () => {
    expect(leadingProvider([], "tokens")).toBeNull();
    expect(
      leadingProvider([{ provider: "codex", costShare: 0, tokenShare: 0 }], "cost"),
    ).toBeNull();
  });
});

describe("wholePercent", () => {
  it.each([
    [0.567, "57%"],
    [1, "100%"],
    [0.004, "<1%"],
    [0.005, "1%"],
    [0, "0%"],
  ])("a share of %d reads %s", (share, text) => {
    expect(wholePercent(share)).toBe(text);
  });
});
