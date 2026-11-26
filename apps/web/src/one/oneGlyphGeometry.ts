/**
 * The flat glyph: the mark's silhouette as a two-tone ring for 12 to 24 pixels. It is drawn
 * on the pixel grid of its own size (radii and band weights snap to half pixels, and the band
 * never gets thinner than a pixel and a half (two from 14 pixels up)) so it reads as a ring and not as a zero.
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
  readonly glint: { readonly x: number; readonly y: number; readonly r: number };
}

const TILT = -24;
const HALF = (value: number) => Math.round(value * 2) / 2;
const QUARTER = (value: number) => Math.round(value * 4) / 4;
const POINT = (value: number) => Number(value.toFixed(2));

function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${POINT(cx - rx)} ${POINT(cy)}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0Z`;
}

/** The glyph's geometry at `size` pixels. */
export function oneGlyphGeometry(size: number): OneGlyphGeometry {
  const c = size / 2;
  const outer = { rx: HALF(size * 0.4), ry: HALF(size * 0.279) };
  // The band is a pixel and a half at the least, so a 12 pixel glyph still has a hole to see.
  const floor = size >= 14 ? 2 : 1.5;
  const across = Math.max(floor, HALF(size * 0.092));
  const along = Math.max(floor, HALF(size * 0.104));
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
  const [x1, y1] = at(198);
  const [x2, y2] = at(252);
  const highlight = `M${x1} ${y1}A${rxm} ${rym} 0 0 1 ${x2} ${y2}`;
  // One o'clock on screen is this angle on the turned band: the glint stays where the lit mark's is.
  const turn = (TILT * Math.PI) / 180;
  const glintAngle = Math.atan2(
    (Math.sin(-turn) * 0.866 + Math.cos(-turn) * -0.5) / rym,
    (Math.cos(-turn) * 0.866 - Math.sin(-turn) * -0.5) / rxm,
  );
  return {
    size,
    tilt: TILT,
    outer,
    inner,
    counter: Math.min(inner.rx, inner.ry) * 2,
    paths: { band, shade, highlight },
    highlightWidth: size >= 18 ? 1 : 0.9,
    glint: {
      x: POINT(c + rxm * Math.cos(glintAngle)),
      y: POINT(c + rym * Math.sin(glintAngle)),
      r: Math.max(0.6, HALF(size * 0.045)),
    },
  };
}

/** The sizes the glyph is drawn for. Any size in between snaps to its own grid the same way. */
export const ONE_GLYPH_SIZES = [12, 14, 16, 18, 20, 24] as const;
