import { useGT } from "gt-react";

/**
 * The tab's headline sentence in the serif, built from the leading provider's real share. A day
 * count of 1 is the past 24 hours; anything else is "the last N days".
 */
export function UsageOverviewHeadline({
  metric,
  provider,
  share,
  total,
  days,
}: {
  readonly metric: "tokens" | "cost";
  readonly provider: string;
  /** Whole percent as text, such as "57%". */
  readonly share: string;
  /** The window's total as text, such as "90.8B" or "$27,715.15". */
  readonly total: string;
  readonly days: number;
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
    <header className="usage-headline-block">
      <h2 className="usage-headline">{sentence}</h2>
    </header>
  );
}
