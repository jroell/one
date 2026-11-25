import type { CSSProperties } from "react";

/**
 * A label's own color is the one thing a tracker lets its owners pick freely, and it ranges from
 * neon yellow to near black. The chip keeps the label's hue (its meaning) and takes lightness and
 * chroma from fixed levels per theme, so a yellow, a purple and a gray label sit together and
 * every one reads at the same strength on light and dark surfaces.
 */

export interface LabelChipTone {
  readonly hue: number;
  /** 0 for a gray label, 1 for any label with a real color. Scales every level's chroma. */
  readonly chromaScale: number;
}

type Theme = "light" | "dark";

interface Level {
  readonly l: number;
  readonly c: number;
  readonly alpha: number;
}

const LABEL_CHIP_LEVELS: Record<Theme, { text: Level; fill: Level; edge: Level; dot: Level }> = {
  light: {
    text: { l: 0.4, c: 0.095, alpha: 1 },
    fill: { l: 0.62, c: 0.14, alpha: 0.14 },
    edge: { l: 0.55, c: 0.12, alpha: 0.3 },
    dot: { l: 0.66, c: 0.15, alpha: 1 },
  },
  dark: {
    text: { l: 0.86, c: 0.09, alpha: 1 },
    fill: { l: 0.7, c: 0.14, alpha: 0.17 },
    edge: { l: 0.75, c: 0.12, alpha: 0.28 },
    dot: { l: 0.76, c: 0.15, alpha: 1 },
  },
};

/** Below this OKLab chroma a label is gray and stays gray. */
const GRAY_CHROMA = 0.03;
/** At or above this chroma a label takes the full level chroma. */
const FULL_CHROMA = 0.06;

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** OKLab chroma and hue (degrees) of a #rrggbb color. */
function hexToOklch(hex: string): { c: number; h: number } {
  const r = srgbToLinear(Number.parseInt(hex.slice(1, 3), 16) / 255);
  const g = srgbToLinear(Number.parseInt(hex.slice(3, 5), 16) / 255);
  const b = srgbToLinear(Number.parseInt(hex.slice(5, 7), 16) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const hue = (Math.atan2(bb, a) * 180) / Math.PI;
  return { c: Math.hypot(a, bb), h: hue < 0 ? hue + 360 : hue };
}

/** The hue and chroma scale for a label's #rrggbb color, or null when it has none. */
export function labelChipTone(color: string | null): LabelChipTone | null {
  if (color === null || !/^#[0-9a-fA-F]{6}$/.test(color)) return null;
  const { c, h } = hexToOklch(color);
  const chromaScale = Math.min(1, Math.max(0, (c - GRAY_CHROMA) / (FULL_CHROMA - GRAY_CHROMA)));
  return { hue: Math.round(h * 10) / 10, chromaScale };
}

export type LabelChipPart = "text" | "fill" | "edge" | "dot";

export function labelChipOklch(theme: Theme, part: LabelChipPart, tone: LabelChipTone) {
  const level = LABEL_CHIP_LEVELS[theme][part];
  return {
    l: level.l,
    c: Math.round(level.c * tone.chromaScale * 1000) / 1000,
    h: tone.hue,
    alpha: level.alpha,
  };
}

function css(theme: Theme, part: LabelChipPart, tone: LabelChipTone): string {
  const { l, c, h, alpha } = labelChipOklch(theme, part, tone);
  return alpha === 1 ? `oklch(${l} ${c} ${h})` : `oklch(${l} ${c} ${h} / ${alpha})`;
}

/** The custom properties the label chip reads: one set per theme, picked by the page styles. */
export function labelChipStyle(tone: LabelChipTone): CSSProperties {
  const style: Record<string, string> = {};
  for (const theme of ["light", "dark"] as const) {
    for (const part of ["text", "fill", "edge", "dot"] as const) {
      style[`--one-label-${part}-${theme}`] = css(theme, part, tone);
    }
  }
  return style as CSSProperties;
}

/**
 * Only a label that says something is stuck keeps its color in the text; every other label is
 * a neutral chip with a small dot in the label's color, so a list of five hues reads as one.
 */
export function labelChipEmphasis(name: string): "alert" | "quiet" {
  return /\bblocked\b/i.test(name) ? "alert" : "quiet";
}
