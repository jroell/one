import { useGT } from "gt-react";

import { WorkingArc } from "~/one/WorkingArc";

/**
 * The tab's headline sentence in the serif, built from the leading provider's real share. A day
 * count of 1 is the past 24 hours; anything else is "the last N days". While coverage is partial
 * or carried over, the sentence keeps its full strength and a quiet "Updating…" note says the
 * figures can still change; nothing on the page is dimmed.
 */
export function UsageOverviewHeadline({
  metric,
  provider,
  share,
  total,
  days,
  loading = false,
}: {
  readonly metric: "tokens" | "cost";
  readonly provider: string;
  /** Whole percent as text, such as "57%". */
  readonly share: string;
  /** The window's total as text, such as "90.8B" or "$27,715.15". */
  readonly total: string;
  readonly days: number;
  /** Coverage is partial or carried over. */
  readonly loading?: boolean;
}) {
  const gt = useGT();
  const parts = { provider, share, total, days };
  const sentence =
    metric === "tokens"
      ? days === 1
        ? gt("{provider} did {share} of {total} tokens in the past 24 hours.", parts)
        : gt("{provider} did {share} of {total} tokens in the last {days} days.", parts)
      : days === 1
        ? gt("{provider} was {share} of {total} in the past 24 hours.", parts)
        : gt("{provider} was {share} of {total} in the last {days} days.", parts);
  return (
    <header className="usage-headline-block" data-loading={loading ? "" : undefined}>
      <h2 className="usage-headline">{sentence}</h2>
      <p role="status" className="usage-updating">
        {loading ? (
          <>
            <WorkingArc size={12} />
            {gt("Updating…")}
          </>
        ) : null}
      </p>
    </header>
  );
}
