import type { UsageProviderKind, UsageTokenTotals } from "@t3tools/contracts";
import {
  isModelCostUnknown,
  type CategoryCost,
  type ModelTotals,
  type SpeedCost,
} from "@t3tools/shared/usageMerge";

import { msg } from "gt-react";

import type { ShareSegment } from "./UsageShareBar";

export function sortModelsByTokens(models: readonly ModelTotals[]) {
  return models.toSorted(
    (left, right) => right.totalTokens - left.totalTokens || right.costUsd - left.costUsd,
  );
}

/** Unknown cost yields null cost share; unpriced models still have token shares. */
export function modelShare(model: ModelTotals, metric: "cost" | "tokens"): number | null {
  if (metric === "tokens") return model.tokenShare;
  return isModelCostUnknown(model) ? null : model.costShare;
}

/** Returns null without input; cache writes count as misses because input was fully processed. */
export function cacheHitRate({ tokens }: ModelTotals): number | null {
  const input = tokens.uncachedInputTokens + tokens.cachedInputTokens + tokens.cacheCreationTokens;
  return input === 0 ? null : tokens.cachedInputTokens / input;
}

/** Effective USD per million priced tokens, or `null` when none were priced. */
export function costPerMillionTokens(model: ModelTotals): number | null {
  const pricedTokens = model.totalTokens - model.unpricedTokens;
  return pricedTokens <= 0 || isModelCostUnknown(model)
    ? null
    : (model.costUsd / pricedTokens) * 1_000_000;
}

/** Bone at a strength, over the panel: the types differ by tone, and none is ever white. */
const bone = (percent: number) => `color-mix(in oklab, var(--st-done) ${percent}%, var(--card))`;

const TYPE_COLORS = {
  input: bone(74),
  cacheRead: bone(40),
  cacheWrite: bone(58),
  output: bone(92),
  other: bone(32),
};

export function costTypeSegments(cost: CategoryCost): readonly ShareSegment[] {
  return [
    { label: msg("Input"), value: cost.input, color: TYPE_COLORS.input },
    { label: msg("Cache read"), value: cost.cacheRead, color: TYPE_COLORS.cacheRead },
    { label: msg("Cache write"), value: cost.cacheWrite, color: TYPE_COLORS.cacheWrite },
    { label: msg("Output"), value: cost.output, color: TYPE_COLORS.output },
    {
      label: msg("Other"),
      value: cost.unsplit >= 0.005 ? cost.unsplit : 0,
      color: TYPE_COLORS.other,
    },
  ];
}

export function tokenTypeSegments(
  tokens: Omit<UsageTokenTotals, "reasoningTokens">,
): readonly ShareSegment[] {
  return [
    { label: msg("Input"), value: tokens.uncachedInputTokens, color: TYPE_COLORS.input },
    { label: msg("Cache read"), value: tokens.cachedInputTokens, color: TYPE_COLORS.cacheRead },
    { label: msg("Cache write"), value: tokens.cacheCreationTokens, color: TYPE_COLORS.cacheWrite },
    { label: msg("Output"), value: tokens.outputTokens, color: TYPE_COLORS.output },
  ];
}

export function speedCostSegments(cost: SpeedCost): readonly ShareSegment[] {
  return [
    { label: msg("Standard"), value: cost.standard, color: bone(38) },
    { label: msg("Fast"), value: cost.fast, color: bone(62) },
    { label: msg("Ultrafast"), value: cost.ultrafast, color: bone(92) },
  ];
}

/** The provider with the largest share of the metric, or null when nothing was used. */
export function leadingProvider(
  providers: readonly {
    readonly provider: UsageProviderKind;
    readonly costShare: number;
    readonly tokenShare: number;
  }[],
  metric: "tokens" | "cost",
): { readonly provider: UsageProviderKind; readonly share: number } | null {
  const shareOf = (entry: (typeof providers)[number]) =>
    metric === "tokens" ? entry.tokenShare : entry.costShare;
  const best = providers.reduce<(typeof providers)[number] | undefined>(
    (top, entry) => (top === undefined || shareOf(entry) > shareOf(top) ? entry : top),
    undefined,
  );
  return best === undefined || shareOf(best) <= 0
    ? null
    : { provider: best.provider, share: shareOf(best) };
}

/** A share for a sentence: whole percent, with "<1%" for a sliver rather than a misleading 0%. */
export function wholePercent(share: number): string {
  return share > 0 && share < 0.005 ? "<1%" : `${Math.round(share * 100)}%`;
}
