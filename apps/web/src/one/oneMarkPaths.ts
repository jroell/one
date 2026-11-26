/**
 * The One mark's one silhouette: a tilted band, 24 units across, turned -24 degrees about (12,12).
 * The lit mark (OneMark), the flat glyph (oneGlyphGeometry.ts) and the boot screen in index.html all draw
 * from these numbers. The boot screen repeats them by hand; bootMark.test.ts keeps it honest.
 */
export const ONE_MARK_PATHS = {
  wall: "M4.6 11.7c0-2.3 3.3-4.2 7.4-4.2s7.4 1.9 7.4 4.2c0-1.5-3.3-2.7-7.4-2.7s-7.4 1.2-7.4 2.7Z",
  band: "M12 5.3c5.3 0 9.6 3 9.6 6.7s-4.3 6.7-9.6 6.7-9.6-3-9.6-6.7 4.3-6.7 9.6-6.7Zm0 2.2c-4.1 0-7.4 1.9-7.4 4.2s3.3 4.2 7.4 4.2 7.4-1.9 7.4-4.2-3.3-4.2-7.4-4.2Z",
  shade: "M19.9 14.7c-1.6 2.1-4.5 3.4-7.9 3.4-2.3 0-4.4-.6-6-1.7",
  specular: "M3.5 10.7c.8-2.3 3.8-4.1 7.6-4.4",
  /** The glint: a short catch-light on the band's right tip, at one o'clock once the band is turned. */
  glint: "M20.4 10.05c.25 0 .45.5.45 1.1s-.2 1.1-.45 1.1-.45-.5-.45-1.1.2-1.1.45-1.1Z",
} as const;

/**
 * The lit band's gradient: key light from the top left at about 35 degrees, so the band is
 * brightest along its upper-left edge, falls into shade through its body, and catches a little
 * bounce light along its lower rim. Offsets run along `ONE_MARK_LIT_AXIS`.
 */
export const ONE_MARK_LIT_STOPS = [
  [0, "hi"],
  [0.14, "mid"],
  [0.4, "lo"],
  [0.6, "mid"],
  [0.76, "hi"],
  [0.88, "mid"],
  [1, "lo"],
] as const;

/** The gradient's axis in the band's frame: the key light's direction turned by the band's tilt. */
export const ONE_MARK_LIT_AXIS = { x1: 6.5, y1: 3.5, x2: 17.5, y2: 20.5 } as const;
