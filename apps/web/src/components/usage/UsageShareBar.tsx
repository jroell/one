import { formatPercent } from "@t3tools/shared/usageFormat";
import { useMessages } from "gt-react";
import type { CSSProperties, ReactNode } from "react";

export interface ShareSegment {
  readonly label: string;
  readonly value: number;
  readonly color: string;
}

/**
 * One row per type: its name, a bar on the shared 0 to 100% scale, its value and its share in
 * text. A tiny share keeps a visible sliver, and the percent is always written out.
 */
export function UsageShareBar({
  label,
  segments,
  format,
  aside,
}: {
  readonly label: string;
  readonly segments: readonly ShareSegment[];
  readonly format: (value: number) => string;
  readonly aside?: ReactNode;
}) {
  const m = useMessages();
  const visible = segments.filter((segment) => segment.value > 0);
  const total = visible.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0) return null;

  return (
    <div className="usage-panel usage-panel-plain usage-share">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="usage-heading">{label}</h3>
        {aside}
      </div>
      <ul aria-label={label} className="usage-share-rows">
        {visible.map((segment, position) => {
          const share = segment.value / total;
          return (
            <li
              key={segment.label}
              className="usage-share-row"
              style={
                {
                  "--usage-seg": segment.color,
                  "--usage-seg-i": position,
                  "--usage-share": `${share * 100}%`,
                } as CSSProperties
              }
            >
              <span className="usage-share-label">
                <span aria-hidden className="usage-share-swatch" />
                {m(segment.label)}
              </span>
              <span aria-hidden className="usage-share-track">
                <span className="usage-share-fill" />
              </span>
              <span className="usage-share-value">{format(segment.value)}</span>
              <span className="usage-share-percent">{formatPercent(share)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
