import type { SVGProps } from "react";

/** The One ring in a single color, for places where it sits among other line icons. */
export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g transform="rotate(-24 12 12)" fill="currentColor">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M12 5.3c5.3 0 9.6 3 9.6 6.7s-4.3 6.7-9.6 6.7-9.6-3-9.6-6.7 4.3-6.7 9.6-6.7Zm0 2.2c-4.1 0-7.4 1.9-7.4 4.2s3.3 4.2 7.4 4.2 7.4-1.9 7.4-4.2-3.3-4.2-7.4-4.2Z"
        />
        <path
          fillOpacity="0.45"
          d="M4.6 11.7c0-2.3 3.3-4.2 7.4-4.2s7.4 1.9 7.4 4.2c0-1.5-3.3-2.7-7.4-2.7s-7.4 1.2-7.4 2.7Z"
        />
      </g>
    </svg>
  );
}
