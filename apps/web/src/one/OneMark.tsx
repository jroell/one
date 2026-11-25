import { useId, type SVGProps } from "react";

import { cn } from "~/lib/utils";
import { ONE_MARK_PATHS } from "./oneMarkPaths";

/**
 * The One mark: a tilted glass band. Every color comes from the `--one-ring-*`
 * tokens in one.css, which follow the active theme.
 */
export function OneMark({
  className,
  interactive = false,
  ...props
}: SVGProps<SVGSVGElement> & {
  /** Plays the reflection sweep on hover and the squash on press of the nearest `.one-mark-host`. */
  readonly interactive?: boolean;
}) {
  const id = useId();
  const band = `${id}band`;
  const wall = `${id}wall`;
  const sheen = `${id}sheen`;
  const spec = `${id}spec`;
  const clip = `${id}clip`;
  return (
    <svg
      aria-hidden="true"
      {...props}
      data-one-mark={interactive ? "interactive" : "static"}
      className={cn("one-mark", className)}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={band} x1="3" y1="8" x2="21" y2="17" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "var(--one-ring-hi)" }} />
          <stop offset="0.2" style={{ stopColor: "var(--one-ring-mid)" }} />
          <stop offset="0.44" style={{ stopColor: "var(--one-ring-lo)" }} />
          <stop offset="0.58" style={{ stopColor: "var(--one-ring-mid)" }} />
          <stop offset="0.7" style={{ stopColor: "var(--one-ring-hi)" }} />
          <stop offset="0.84" style={{ stopColor: "var(--one-ring-mid)" }} />
          <stop offset="1" style={{ stopColor: "var(--one-ring-lo)" }} />
        </linearGradient>
        <linearGradient id={wall} x1="5" y1="9" x2="19" y2="9" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "var(--one-ring-deep)" }} />
          <stop offset="0.6" style={{ stopColor: "var(--one-ring-lo)" }} />
          <stop offset="1" style={{ stopColor: "var(--one-ring-mid)" }} />
        </linearGradient>
        <linearGradient id={spec} x1="3.5" y1="10" x2="11" y2="6" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "var(--one-ring-spec)" }} stopOpacity="0" />
          <stop offset="0.35" style={{ stopColor: "var(--one-ring-spec)" }} stopOpacity="0.95" />
          <stop offset="1" style={{ stopColor: "var(--one-ring-spec)" }} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={sheen} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: "var(--one-ring-spec)" }} stopOpacity="0" />
          <stop offset="0.5" style={{ stopColor: "var(--one-ring-spec)" }} stopOpacity="0.9" />
          <stop offset="1" style={{ stopColor: "var(--one-ring-spec)" }} stopOpacity="0" />
        </linearGradient>
        <clipPath id={clip}>
          <path clipRule="evenodd" d={ONE_MARK_PATHS.band} />
        </clipPath>
      </defs>
      <g transform="rotate(-24 12 12)">
        {/* Inner wall: the far side of the band, seen through the opening. */}
        <path fill={`url(#${wall})`} d={ONE_MARK_PATHS.wall} />
        {/* Outer band. */}
        <path
          fill={`url(#${band})`}
          fillRule="evenodd"
          clipRule="evenodd"
          d={ONE_MARK_PATHS.band}
        />
        {/* Soft shade where the band turns away from the light. */}
        <path
          d={ONE_MARK_PATHS.shade}
          stroke="var(--one-ring-deep)"
          strokeOpacity="0.38"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
        {/* Specular lights. */}
        <path
          d={ONE_MARK_PATHS.specular}
          stroke={`url(#${spec})`}
          strokeWidth="1"
          strokeLinecap="round"
        />
        <path
          d="M8 17.1c1.3.4 2.6.6 4 .6 1.1 0 2.1-.1 3-.4"
          stroke="var(--one-ring-spec)"
          strokeWidth="0.45"
          strokeLinecap="round"
          strokeOpacity="0.5"
        />
        {/* A band of light that travels across the ring on hover. */}
        <g clipPath={`url(#${clip})`}>
          <rect
            className="one-mark-sheen"
            x="-9"
            y="2"
            width="7"
            height="20"
            fill={`url(#${sheen})`}
            transform="skewX(-18)"
          />
        </g>
      </g>
    </svg>
  );
}
