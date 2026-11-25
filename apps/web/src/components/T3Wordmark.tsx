import type { SVGProps } from "react";

export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(-24 12 12)">
        <ellipse cx="12" cy="12" rx="9" ry="6.2" stroke="currentColor" strokeWidth="2.6" />
        <ellipse
          cx="12"
          cy="12.5"
          rx="6.8"
          ry="4.2"
          stroke="currentColor"
          strokeWidth="0.9"
          strokeOpacity="0.45"
        />
        <path
          d="M5.4 9.5C7.1 7.6 9.5 6.8 12.2 6.8"
          stroke="currentColor"
          strokeWidth="0.9"
          strokeLinecap="round"
          strokeOpacity="0.55"
        />
      </g>
    </svg>
  );
}
