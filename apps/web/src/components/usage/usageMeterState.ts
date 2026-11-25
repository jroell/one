import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { elapsedShare, type LimitPace } from "@t3tools/shared/usageLimits";

/** The mobile subscription widgets already turn the figure to the danger color at 10% left. */
const CRITICAL_REMAINING_PERCENT = 10;
const LOW_REMAINING_PERCENT = 25;

export type MeterState = "comfortable" | "low" | "critical";

export function meterState(remaining: number): MeterState {
  if (remaining <= CRITICAL_REMAINING_PERCENT) return "critical";
  if (remaining <= LOW_REMAINING_PERCENT) return "low";
  return "comfortable";
}

/**
 * The stretch between the fill and the even-pace marker, in percent of the channel. It exists only
 * when spending is ahead of the window (the `paceOf` verdict), so a quiet meter stays quiet.
 */
export function behindPaceGap(
  remaining: number,
  timeLeft: number | null,
  pace: LimitPace | null,
): { readonly from: number; readonly to: number } | null {
  if (pace !== "ahead" || timeLeft === null || timeLeft <= remaining) return null;
  return { from: remaining, to: timeLeft };
}

export type LimitProjection =
  | { readonly kind: "none" }
  | { readonly kind: "plenty" }
  | { readonly kind: "on-track" }
  | { readonly kind: "exhausted" }
  | {
      readonly kind: "runs-out";
      /** Time until the share left is gone at the pace so far. */
      readonly runsOutInMs: number;
      /** How much earlier than the reset that is. */
      readonly beforeResetMs: number;
    };

/** Under a minute of difference is the same as arriving at the reset. */
const RUNS_OUT_MARGIN_MS = 60_000;
/** Spending that ends the window at half or less counts as plenty. */
const PLENTY_PROJECTED_USED_PERCENT = 50;

/**
 * Where a limit is heading if the pace so far continues: spend rate is the share used over the
 * time elapsed, and time to empty is the share left over that rate. A window with no clock, a reset
 * already past, or nothing elapsed yet has no basis for a projection.
 */
export function projectLimit(input: {
  readonly usedPercent: number;
  readonly windowMs: number | null;
  readonly msToReset: number | null;
}): LimitProjection {
  const { windowMs, msToReset } = input;
  if (windowMs === null || msToReset === null || windowMs <= 0 || msToReset <= 0) {
    return { kind: "none" };
  }
  const used = Math.max(0, Math.min(100, input.usedPercent));
  const remaining = 100 - used;
  if (remaining <= 0) return { kind: "exhausted" };
  if (used === 0) return { kind: "plenty" };
  const elapsedMs = Math.min(windowMs, windowMs - msToReset);
  if (elapsedMs <= 0) return { kind: "none" };
  const msPerPercent = elapsedMs / used;
  const runsOutInMs = remaining * msPerPercent;
  if (runsOutInMs < msToReset - RUNS_OUT_MARGIN_MS) {
    return { kind: "runs-out", runsOutInMs, beforeResetMs: msToReset - runsOutInMs };
  }
  const projectedUsed = used + msToReset / msPerPercent;
  return projectedUsed <= PLENTY_PROJECTED_USED_PERCENT ? { kind: "plenty" } : { kind: "on-track" };
}

/**
 * The window clock of a card. A pool of accounts takes the mean share elapsed, as the pool's own
 * pace does, and the first window's length.
 */
export function limitClock(
  windows: readonly ServerProviderUsageWindow[],
  now: number,
): { readonly windowMs: number; readonly msToReset: number } | null {
  const timed = windows.flatMap((window) => {
    const elapsed = elapsedShare(window, now);
    return elapsed === null || window.windowDurationMins === undefined
      ? []
      : [{ elapsed, windowMs: window.windowDurationMins * 60_000 }];
  });
  const first = timed[0];
  if (first === undefined) return null;
  const meanElapsed = timed.reduce((sum, entry) => sum + entry.elapsed, 0) / timed.length;
  return { windowMs: first.windowMs, msToReset: (1 - meanElapsed) * first.windowMs };
}
