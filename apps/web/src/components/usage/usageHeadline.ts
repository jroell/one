import { msg } from "gt-react";

import { m as defaultResolver, type MessageResolver } from "~/i18n/messages";
import type { LimitProjection } from "./usageMeterState";

export interface LimitCandidate<Subject> {
  readonly subject: Subject;
  readonly remainingPercent: number;
  readonly projection: LimitProjection;
}

/**
 * The limit to watch: the one that runs out soonest at its pace so far (a limit already used up
 * comes first), and when nothing is on course to run out, the one with the least left. Ties keep
 * the order the page lists them in.
 */
export function tightestLimit<Subject>(
  candidates: readonly LimitCandidate<Subject>[],
): LimitCandidate<Subject> | undefined {
  const timeToEmpty = (projection: LimitProjection) => {
    if (projection.kind === "exhausted") return 0;
    return projection.kind === "runs-out" ? projection.runsOutInMs : Number.POSITIVE_INFINITY;
  };
  return candidates.reduce<LimitCandidate<Subject> | undefined>((best, candidate) => {
    if (best === undefined) return candidate;
    const byTime = timeToEmpty(candidate.projection) - timeToEmpty(best.projection);
    if (byTime !== 0 && !Number.isNaN(byTime)) return byTime < 0 ? candidate : best;
    return candidate.remainingPercent < best.remainingPercent ? candidate : best;
  }, undefined);
}

/** Window names the servers send in English, as they read inside a sentence. */
const WINDOW_NAMES: Readonly<Record<string, Parameters<MessageResolver>[0]>> = {
  Session: msg("session", { $context: "usage window name inside a sentence" }),
  Weekly: msg("weekly", { $context: "usage window name inside a sentence" }),
  Monthly: msg("monthly", { $context: "usage window name inside a sentence" }),
  "Monthly spend": msg("monthly spend", { $context: "usage window name inside a sentence" }),
  Overall: msg("overall", { $context: "usage window name inside a sentence" }),
};

/**
 * A window label for a sentence. A known name ("Weekly") is localized; the model after a dot
 * ("Weekly · Fable") and any name the page does not know keep the server's spelling.
 */
export function inlineWindowName(
  label: string,
  resolve: MessageResolver = defaultResolver,
): string {
  const [base = label, ...rest] = label.split(" · ");
  const known = WINDOW_NAMES[base];
  return known === undefined ? label : [resolve(known), ...rest].join(" · ");
}
