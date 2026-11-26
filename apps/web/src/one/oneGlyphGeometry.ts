/**
 * The flat glyph: the mark's silhouette as a ring for sizes below 28 pixels. The stroke is about
 * 22% of the diameter, so the hole stays open and it never reads as the letter O, and it is drawn
 * on the pixel grid of its own size (radii and weights snap to half pixels, two at the least).
 */

export interface OneGlyphGeometry {
  readonly size: number;
  /** The band turn, in degrees, the same as the lit mark's. */
  readonly tilt: number;
  /** Outer and inner radii of the band across and along its length, in pixels. */
  readonly outer: { readonly rx: number; readonly ry: number };
  readonly inner: { readonly rx: number; readonly ry: number; readonly dy: number };
  /** The strongest thing a reader sees through the opening: its smaller dimension in pixels. */
  readonly counter: number;
  readonly paths: {
    readonly band: string;
    readonly shade: string;
    readonly highlight: string;
  };
  readonly highlightWidth: number;
}

const TILT = -28;
const HALF = (value: number) => Math.round(value * 2) / 2;
const QUARTER = (value: number) => Math.round(value * 4) / 4;
const POINT = (value: number) => Number(value.toFixed(2));

function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${POINT(cx - rx)} ${POINT(cy)}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0Z`;
}

/** The glyph's geometry at `size` pixels. */
export function oneGlyphGeometry(size: number): OneGlyphGeometry {
  const c = size / 2;
  const outer = { rx: HALF(size * 0.42), ry: HALF(size * 0.32) };
  const across = Math.max(2, HALF(size * 0.185));
  const along = Math.max(2, HALF(size * 0.14));
  const inner = {
    rx: outer.rx - across,
    ry: outer.ry - along,
    // The opening sits a little high, so the band is thicker below it, as in the lit mark.
    dy: -QUARTER(Math.max(0.25, size * 0.0125)),
  };
  const band = ellipse(c, c, outer.rx, outer.ry) + ellipse(c, c + inner.dy, inner.rx, inner.ry);
  // The lower crescent of the band: the outer ellipse less itself moved up, clipped to the band.
  const lift = QUARTER(Math.max(0.75, along * 0.85));
  const shade = ellipse(c, c, outer.rx, outer.ry) + ellipse(c, c - lift, outer.rx, outer.ry);
  const rxm = outer.rx - across / 2;
  const rym = outer.ry - along / 2;
  const at = (degrees: number) => {
    const t = (degrees * Math.PI) / 180;
    return [POINT(c + rxm * Math.cos(t)), POINT(c + rym * Math.sin(t))] as const;
  };
  const [x1, y1] = at(188);
  const [x2, y2] = at(296);
  const highlight = `M${x1} ${y1}A${rxm} ${rym} 0 0 1 ${x2} ${y2}`;
  return {
    size,
    tilt: TILT,
    outer,
    inner,
    counter: Math.min(inner.rx, inner.ry) * 2,
    paths: { band, shade, highlight },
    highlightWidth: Math.max(1, HALF(size * 0.06)),
  };
}

/** The sizes the glyph is drawn for. Any size in between snaps to its own grid the same way. */
export const ONE_GLYPH_SIZES = [12, 14, 16, 18, 20, 24] as const;
