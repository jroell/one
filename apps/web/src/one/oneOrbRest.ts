/**
 * The ring's rest pose and the numbers it shares with `scripts/render-mark.mjs`, which draws the
 * static mark (public/mark) from the same shader at this pose. Nothing here imports the app, so
 * Node can load it.
 */

/** The resting angle that shows the opening of the ring. The band looks the same every half turn. */
export const ORB_OPEN_ANGLE = 0.48;

/** Uniform values of an idle ring at rest, which is also what reduced motion draws. */
export const ORB_REST = {
  time: 0,
  spin: ORB_OPEN_ANGLE,
  tilt: 0.72,
  pulse: 0,
  energy: 0,
  aura: 0.3,
  reveal: 1,
  orbit: 0,
} as const;

/** A small ring is drawn at twice the screen's density and averaged down, so its rim does not sparkle. */
export const ORB_SUPERSAMPLE = 2;

/** A ring wider than this casts the shared halo (`.one-ring-halo`): the same recipe at every size. */
export const ONE_RING_HALO_MIN_PX = 40;

/** How much light a ring of this CSS width gives off: none up to 40px, all of it above, like its halo. */
export function glowForSize(cssWidth: number): number {
  return cssWidth > ONE_RING_HALO_MIN_PX ? 1 : 0;
}

/** The shared gold ramp (`--gold-*` in one-ui.css) as the ring's three colors in the standard theme. */
export const ORB_GOLD = { hi: "#f1d58a", mid: "#c2973a", lo: "#6e5118" } as const;

/** CSS sizes the static mark is drawn for, and the screen densities each is drawn at. */
export const ORB_MARK_SIZES = [48, 64, 96, 128, 176, 256, 512] as const;
export const ORB_MARK_DENSITIES = [1, 2, 3] as const;

export type OrbMarkSize = (typeof ORB_MARK_SIZES)[number];

/** The one-colour ring for small system uses (menu bar, notifications): black, for templating. */
export const ORB_MARK_MONO_URL = "/mark/ring-mono.svg";

/** The file for a theme, CSS size and screen density, relative to the site root. */
export function orbMarkUrl(theme: "dark" | "light", size: OrbMarkSize, density: number): string {
  return `/mark/ring-${theme}-${size}@${density}x.webp`;
}
