import { formatPercent } from "@t3tools/shared/usageFormat";
import { useMessages } from "gt-react";
import type { CSSProperties, ReactNode } from "react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface ShareSegment {
  readonly label: string;
  readonly value: number;
  readonly color: string;
}

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
      {/* The legend below carries every figure; the bar's tooltips are pointer-only. */}
      <div aria-hidden className="usage-share-track">
        {visible.map((segment, position) => (
          <Tooltip key={segment.label}>
            <TooltipTrigger
              render={
                <div
                  className="usage-share-seg"
                  style={
                    {
                      flex: `${segment.value} 1 0`,
                      "--usage-seg": segment.color,
                      "--usage-seg-i": position,
                    } as CSSProperties
                  }
                />
              }
            />
            <TooltipPopup>
              {m(segment.label)} · {format(segment.value)} · {formatPercent(segment.value / total)}
            </TooltipPopup>
          </Tooltip>
        ))}
      </div>
      <ul aria-label={label} className="usage-share-legend">
        {visible.map((segment) => (
          <li key={segment.label} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="usage-share-swatch"
              style={{ "--usage-seg": segment.color } as CSSProperties}
            />
            <span className="text-muted-foreground">{m(segment.label)}</span>{" "}
            <span className="text-foreground tabular-nums">{format(segment.value)}</span>
            <span className="sr-only">, {formatPercent(segment.value / total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
