import type { GuidedThreadInfo } from "./guidedThread";

/**
 * What a guided thread says about itself now: only under the first answer, naming the provider
 * whose run produced it, and naming a passed-over provider only until its usage returns.
 */
export function liveGuidedInfo(input: {
  readonly stored: GuidedThreadInfo | null;
  /** The name of the provider whose run produced the first answer; null until there is one. */
  readonly firstAnswerProvider: string | null;
  /** How many runs have produced an answer. */
  readonly answeredRuns: number;
  readonly now: number;
}): GuidedThreadInfo | null {
  const { stored } = input;
  if (stored === null || input.answeredRuns >= 2) return null;
  const resetsAt = stored.skipped?.resetsAt;
  const reset = resetsAt == null ? Number.NaN : Date.parse(resetsAt);
  const stillOut = stored.skipped !== undefined && !(Number.isFinite(reset) && reset <= input.now);
  return {
    asked: input.firstAnswerProvider ?? stored.asked,
    ...(stillOut && stored.skipped !== undefined ? { skipped: stored.skipped } : {}),
    actions: stored.actions,
  };
}
