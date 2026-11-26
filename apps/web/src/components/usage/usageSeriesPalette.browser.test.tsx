import { describe, expect, it } from "vite-plus/test";

import "~/index.css";

import { PROVIDER_PRESENTATION } from "./usageProviders";

// The five providers that appear together most often. The other three are rare and may sit closer.
const MAIN = ["codex", "claude", "antigravity", "grok", "muse"] as const;

type Linear = readonly [number, number, number];

// Machado, Oliveira and Fernandes (2009), full severity, on linear sRGB.
const VISIONS: Record<string, readonly (readonly [number, number, number])[]> = {
  normal: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const toLinear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function pixel(css: string, under?: string): readonly [number, number, number] {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  for (const layer of under === undefined ? [css] : [under, css]) {
    context.fillStyle = layer;
    context.fillRect(0, 0, 1, 1);
  }
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

const linear = (rgb: readonly [number, number, number]): Linear => [
  toLinear(rgb[0]),
  toLinear(rgb[1]),
  toLinear(rgb[2]),
];

const apply = (matrix: (typeof VISIONS)[string], [r, g, b]: Linear): Linear => [
  Math.min(1, Math.max(0, matrix[0]![0] * r + matrix[0]![1] * g + matrix[0]![2] * b)),
  Math.min(1, Math.max(0, matrix[1]![0] * r + matrix[1]![1] * g + matrix[1]![2] * b)),
  Math.min(1, Math.max(0, matrix[2]![0] * r + matrix[2]![1] * g + matrix[2]![2] * b)),
];

function oklab([r, g, b]: Linear): Linear {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

const distance = (a: Linear, b: Linear) => {
  const p = oklab(a);
  const q = oklab(b);
  return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

const luminance = ([r, g, b]: Linear) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const contrast = (a: Linear, b: Linear) => {
  const [high, low] = [luminance(a), luminance(b)].toSorted((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
};

/** Each provider's series colour and the panel it sits on, as the page paints them. */
function themeColours(theme: "dark" | "light") {
  document.documentElement.classList.toggle("dark", theme === "dark");
  const page = document.createElement("div");
  const panel = document.createElement("div");
  panel.className = "usage-panel";
  document.body.append(page, panel);
  try {
    const background = getComputedStyle(document.body).backgroundColor;
    const surface = pixel(getComputedStyle(panel).backgroundColor, background);
    const series = Object.fromEntries(
      (Object.keys(PROVIDER_PRESENTATION) as (keyof typeof PROVIDER_PRESENTATION)[]).map((id) => {
        page.style.color = PROVIDER_PRESENTATION[id].color;
        return [id, pixel(getComputedStyle(page).color)] as const;
      }),
    );
    return { surface, series };
  } finally {
    page.remove();
    panel.remove();
    document.documentElement.classList.remove("dark");
  }
}

describe("the provider series palette", () => {
  it.each(["dark", "light"] as const)(
    "keeps the five main providers apart under every colour vision and 3:1 on the panel in %s",
    (theme) => {
      const { surface, series } = themeColours(theme);
      for (const id of MAIN) {
        expect(
          contrast(linear(series[id]!), linear(surface)),
          `${id} on the ${theme} panel`,
        ).toBeGreaterThanOrEqual(3);
      }
      for (const [vision, matrix] of Object.entries(VISIONS)) {
        for (let first = 0; first < MAIN.length; first += 1) {
          for (let second = first + 1; second < MAIN.length; second += 1) {
            const a = MAIN[first]!;
            const b = MAIN[second]!;
            expect(
              distance(apply(matrix, linear(series[a]!)), apply(matrix, linear(series[b]!))),
              `${a} and ${b} under ${vision} in ${theme}`,
            ).toBeGreaterThanOrEqual(6);
          }
        }
      }
    },
  );

  it.each(["dark", "light"] as const)(
    "has no saturated rainbow in %s: every series stays under a chroma of 0.15",
    (theme) => {
      const { series } = themeColours(theme);
      for (const [id, rgb] of Object.entries(series)) {
        const [l, a, b] = oklab(linear(rgb));
        expect(Math.hypot(a, b), `${id} (L ${l.toFixed(2)})`).toBeLessThan(0.15);
      }
    },
  );
});
