import { msg } from "gt-react";

import { m as defaultResolver, type MessageResolver } from "~/i18n/messages";
import type { LimitProjection } from "./usageMeterState";

export interface LimitCandidate<Subject> {
  readonly subject: Subject;
  readonly remainingPercent: number;
  readonly projection: LimitProjection;
}

/**
 * The limit to watch. Actual exhaustion comes first, read from the quota left so it needs no
 * clock; then the limit that runs out soonest at its pace so far; then the one with the least
 * left. Ties keep the order the page lists them in.
 */
export function tightestLimit<Subject>(
  candidates: readonly LimitCandidate<Subject>[],
): LimitCandidate<Subject> | undefined {
  const timeToEmpty = (candidate: LimitCandidate<Subject>) => {
    const { projection } = candidate;
    if (candidate.remainingPercent <= 0 || projection.kind === "exhausted") return 0;
    return projection.kind === "runs-out" ? projection.runsOutInMs : Number.POSITIVE_INFINITY;
  };
  return candidates.reduce<LimitCandidate<Subject> | undefined>((best, candidate) => {
    if (best === undefined) return candidate;
    const byTime = timeToEmpty(candidate) - timeToEmpty(best);
    if (byTime !== 0 && !Number.isNaN(byTime)) return byTime < 0 ? candidate : best;
    return candidate.remainingPercent < best.remainingPercent ? candidate : best;
  }, undefined);
}

export interface WindowIdentity {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
}

const NAME_CONTEXT = { $context: "usage window name inside a sentence" } as const;

/**
 * The windows the app's own providers name, by the label they send together with the window's
 * identity (its id or kind), as they read inside a sentence. Anything else is a name the source
 * defined and keeps its spelling.
 */
/* oxlint-disable t3code/no-untranslated-copy -- `label` values are the English labels servers send, matched not shown */
const BUILT_IN_WINDOWS: ReadonlyArray<{
  readonly label: string;
  readonly id?: string;
  readonly kind?: string;
  readonly name: Parameters<MessageResolver>[0];
}> = [
  { label: "Session", kind: "session", name: msg("session", NAME_CONTEXT) },
  { label: "Weekly", kind: "weekly", name: msg("weekly", NAME_CONTEXT) },
  { label: "Monthly", kind: "monthly", name: msg("monthly", NAME_CONTEXT) },
  { label: "Monthly spend", kind: "monthly", name: msg("monthly spend", NAME_CONTEXT) },
  {
    label: "Monthly credit limit",
    id: "individual",
    kind: "monthly",
    name: msg("monthly credit limit", NAME_CONTEXT),
  },
  { label: "Overall", id: "totalPercentUsed", name: msg("overall", NAME_CONTEXT) },
  { label: "Cursor Models", id: "autoPercentUsed", name: msg("Cursor models", NAME_CONTEXT) },
  { label: "Other Models", id: "apiPercentUsed", name: msg("other models", NAME_CONTEXT) },
  { label: "Subscription", name: msg("subscription", NAME_CONTEXT) },
];
/* oxlint-enable t3code/no-untranslated-copy */

/**
 * A window's name for a sentence. A built-in name is localized; the model after a dot
 * ("Weekly · Fable") and any name a source defined keep the spelling they were sent in.
 */
export function inlineWindowName(
  window: WindowIdentity,
  resolve: MessageResolver = defaultResolver,
): string {
  const [base = window.label, ...rest] = window.label.split(" · ");
  const known = BUILT_IN_WINDOWS.find(
    (entry) =>
      entry.label === base &&
      (entry.id === undefined || entry.id === window.id) &&
      (entry.kind === undefined || entry.kind === window.kind || rest.length > 0),
  );
  return known === undefined ? window.label : [resolve(known.name), ...rest].join(" · ");
}
