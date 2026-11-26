import { useLayoutEffect, useRef, useState } from "react";

import { observeResize } from "~/lib/observeResize";
import { spreadLabels } from "./usageAreaLabels";

export interface AreaLabel {
  readonly key: string;
  readonly name: string;
  readonly color: string;
  /** Where the series sits at the end of the plot, as a share of the plot's height from the top. */
  readonly at: number;
}

const LABEL_GAP = 18;
const LEADER = 14;

/**
 * Names the series of the hourly area chart at the end of its lines, in the page's UI sans. A
 * label that would touch its neighbour is moved clear of it and joined to its series by a leader.
 */
export function UsageEndLabels({
  labels,
  focused,
}: {
  readonly labels: readonly AreaLabel[];
  readonly focused: string | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the plot's height so labels can be placed in pixels
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    setHeight(element.clientHeight);
    return observeResize(element, () => setHeight(element.clientHeight));
  }, []);

  const wanted = labels.map((label) => label.at * height);
  const placed = height === 0 ? wanted : spreadLabels(wanted, LABEL_GAP, height);
  return (
    <div ref={ref} aria-hidden className="usage-area-labels">
      <svg className="usage-area-leaders" width={LEADER} height={height}>
        {labels.map((label, index) => (
          <path
            key={label.key}
            d={`M0 ${wanted[index]} L${LEADER / 2} ${wanted[index]} L${LEADER / 2} ${placed[index]} L${LEADER} ${placed[index]}`}
            fill="none"
            stroke={label.color}
            strokeWidth={1.5}
            strokeOpacity={focused !== null && focused !== label.key ? 0.25 : 1}
          />
        ))}
      </svg>
      {labels.map((label, index) => (
        <span
          key={label.key}
          className="usage-area-label"
          data-dim={focused !== null && focused !== label.key ? "" : undefined}
          style={{ top: placed[index] }}
        >
          {label.name}
        </span>
      ))}
    </div>
  );
}
