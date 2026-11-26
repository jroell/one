import type { HTMLAttributes } from "react";

import { cn } from "~/lib/utils";

/**
 * The working indicator: a 2px arc of 270 degrees that turns once every 1.2 seconds, in the
 * working status color. Under reduced motion it holds still. Size it with `size` (pixels).
 */
export function WorkingArc({
  size = 14,
  className,
  ...props
}: Omit<HTMLAttributes<HTMLSpanElement>, "children"> & { readonly size?: number }) {
  const radius = size / 2 - 1;
  return (
    <span
      aria-hidden="true"
      {...props}
      data-working-arc=""
      className={cn("one-working-arc", className)}
      style={{ width: size, height: size, ...props.style }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${(radius * Math.PI * 3) / 2} ${radius * Math.PI * 2}`}
        />
      </svg>
    </span>
  );
}
