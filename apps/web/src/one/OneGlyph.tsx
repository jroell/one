import { useId, type SVGProps } from "react";

import { cn } from "~/lib/utils";
import { oneGlyphGeometry } from "./oneGlyphGeometry";

/**
 * The One mark as a flat two-tone ring, for 12 to 24 pixels. Larger than that, use OneMark.
 * Its colors come from `--one-brand`, so every theme gets its own gold.
 */
export function OneGlyph({
  size = 16,
  className,
  ...props
}: Omit<SVGProps<SVGSVGElement>, "width" | "height" | "viewBox"> & {
  /** Pixels across; the glyph snaps its geometry to the grid of this size. */
  readonly size?: number;
}) {
  const id = useId();
  const geometry = oneGlyphGeometry(size);
  const clip = `${id}band`;
  const center = size / 2;
  return (
    <svg
      aria-hidden="true"
      {...props}
      data-one-glyph={size}
      className={cn("one-glyph", className)}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="geometricPrecision"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <clipPath id={clip}>
          <path clipRule="evenodd" d={geometry.paths.band} />
        </clipPath>
      </defs>
      <g transform={`rotate(${geometry.tilt} ${center} ${center})`}>
        <path data-glyph="base" fillRule="evenodd" d={geometry.paths.band} />
        <g clipPath={`url(#${clip})`}>
          <path data-glyph="shade" fillRule="evenodd" d={geometry.paths.shade} />
        </g>
        <path
          data-glyph="highlight"
          d={geometry.paths.highlight}
          fill="none"
          strokeWidth={geometry.highlightWidth}
          strokeLinecap="round"
        />
        <circle
          data-glyph="glint"
          cx={geometry.glint.x}
          cy={geometry.glint.y}
          r={geometry.glint.r}
        />
      </g>
    </svg>
  );
}
