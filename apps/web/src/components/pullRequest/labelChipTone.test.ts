import { describe, expect, it } from "vite-plus/test";

import {
  labelChipEmphasis,
  labelChipOklch,
  labelChipTone,
  type LabelChipPart,
} from "./labelChipTone";

/** OKLCH to sRGB, clipped to gamut the way a browser's fallback does it. */
function oklchToRgb(l: number, c: number, hue: number): [number, number, number] {
  const a = c * Math.cos((hue * Math.PI) / 180);
  const b = c * Math.sin((hue * Math.PI) / 180);
  const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sp = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp,
    -1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp,
    -0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp,
  ];
  const encode = (value: number) => {
    const clipped = Math.min(1, Math.max(0, value));
    return clipped <= 0.0031308 ? 12.92 * clipped : 1.055 * clipped ** (1 / 2.4) - 0.055;
  };
  return [encode(linear[0]!), encode(linear[1]!), encode(linear[2]!)];
}

function luminance([r, g, b]: readonly [number, number, number]): number {
  const channel = (value: number) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const [high, low] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

function layer(
  part: LabelChipPart,
  theme: "light" | "dark",
  tone: NonNullable<ReturnType<typeof labelChipTone>>,
  under: readonly [number, number, number],
): [number, number, number] {
  const { l, c, h, alpha } = labelChipOklch(theme, part, tone);
  const rgb = oklchToRgb(l, c, h);
  return [0, 1, 2].map((i) => rgb[i]! * alpha + under[i]! * (1 - alpha)) as [
    number,
    number,
    number,
  ];
}

// The lightest and darkest surfaces a chip can sit on: white, a hovered light row, the app's
// near-black, and a selected dark row tinted by the brand color.
const SURFACES = {
  light: [
    [1, 1, 1],
    [0.93, 0.93, 0.94],
    [0.97, 0.94, 0.86],
  ],
  dark: [
    [0.04, 0.04, 0.04],
    [0.12, 0.12, 0.12],
    [0.18, 0.15, 0.08],
  ],
} as const;

function hex(hue: number, value: number, chroma: number): string {
  const [r, g, b] = oklchToRgb(value, chroma, hue);
  return `#${[r, g, b]
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

describe("label chip color", () => {
  it("keeps chip text at 4.5:1 or more on light and dark surfaces for every label hue", () => {
    const worst = { light: Infinity, dark: Infinity };
    for (let hue = 0; hue < 360; hue += 3) {
      // Neon, mid and near-black versions of each hue, as trackers let owners pick any of them.
      for (const [value, chroma] of [
        [0.95, 0.2],
        [0.6, 0.16],
        [0.25, 0.08],
      ] as const) {
        const tone = labelChipTone(hex(hue, value, chroma));
        expect(tone).not.toBeNull();
        for (const theme of ["light", "dark"] as const) {
          for (const surface of SURFACES[theme]) {
            const fill = layer("fill", theme, tone!, surface);
            const text = layer("text", theme, tone!, fill);
            worst[theme] = Math.min(worst[theme], contrast(text, fill));
          }
        }
      }
    }
    expect(worst.light).toBeGreaterThanOrEqual(4.5);
    expect(worst.dark).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps a gray or black label gray instead of inventing a hue", () => {
    for (const gray of ["#000000", "#808080", "#ffffff", "#ededed"]) {
      const tone = labelChipTone(gray);
      expect(tone?.chromaScale).toBe(0);
      expect(labelChipOklch("light", "text", tone!).c).toBe(0);
      expect(labelChipOklch("dark", "dot", tone!).c).toBe(0);
    }
  });

  it("gives a saturated label the full chip chroma and the label's own hue", () => {
    const tone = labelChipTone("#0075ca");
    expect(tone?.chromaScale).toBe(1);
    expect(tone?.hue).toBeGreaterThan(240);
    expect(tone?.hue).toBeLessThan(270);
  });

  it("returns no tone for a missing or malformed color", () => {
    expect(labelChipTone(null)).toBeNull();
    expect(labelChipTone("blue")).toBeNull();
    expect(labelChipTone("#12345")).toBeNull();
  });
});

describe("label chip emphasis", () => {
  it("keeps color in the text only for a blocked label", () => {
    expect(labelChipEmphasis("takeover:blocked")).toBe("alert");
    expect(labelChipEmphasis("Blocked on review")).toBe("alert");
    for (const name of ["vouch:trusted", "size:L", "needs-rebase", "unblocked-soon", "bug"]) {
      expect(labelChipEmphasis(name)).toBe("quiet");
    }
  });
});
