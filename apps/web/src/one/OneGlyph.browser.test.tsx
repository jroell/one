import { describe, expect, it } from "vite-plus/test";

import "~/index.css";

import { render } from "../../test/render";
import { OneGlyph } from "./OneGlyph";
import { ONE_GLYPH_SIZES, oneGlyphGeometry } from "./oneGlyphGeometry";

/** Draws the glyph the way a screen would: computed paint inlined, rasterized at `density`. */
async function rasterize(svg: SVGSVGElement, density: number): Promise<ImageData> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const live = svg.querySelectorAll("[data-glyph]");
  copy.querySelectorAll("[data-glyph]").forEach((node, index) => {
    const style = getComputedStyle(live[index] as Element);
    node.setAttribute("fill", style.fill);
    node.setAttribute("stroke", style.stroke);
  });
  const size = Number(svg.dataset.oneGlyph);
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml" }),
  );
  const image = new Image();
  image.src = url;
  await image.decode();
  URL.revokeObjectURL(url);
  const canvas = document.createElement("canvas");
  canvas.width = size * density;
  canvas.height = size * density;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d context");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function alphaAt(image: ImageData, x: number, y: number): number {
  const px = Math.min(image.width - 1, Math.max(0, Math.round(x)));
  const py = Math.min(image.height - 1, Math.max(0, Math.round(y)));
  return image.data[(py * image.width + px) * 4 + 3] ?? 0;
}

/** Any CSS color as [r, g, b], read back through a canvas so every color syntax compares alike. */
function colorOf(css: string): number[] {
  const swatch = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!swatch) throw new Error("no 2d context");
  swatch.fillStyle = css;
  swatch.fillRect(0, 0, 1, 1);
  return Array.from(swatch.getImageData(0, 0, 1, 1).data.slice(0, 3));
}

const lightness = ([r = 0, g = 0, b = 0]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function glyphIn(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector<SVGSVGElement>("svg[data-one-glyph]");
  if (!svg) throw new Error("the glyph did not render");
  return svg;
}

function paintOf(svg: SVGSVGElement, name: string, property: "fill" | "stroke" = "fill"): string {
  const part = svg.querySelector(`[data-glyph="${name}"]`);
  if (!part) throw new Error(`the glyph has no ${name} part`);
  return getComputedStyle(part)[property];
}

describe("the flat One glyph", () => {
  it.each(ONE_GLYPH_SIZES)(
    "draws a ring with a visible opening at %ipx, at 1x and 2x",
    async (size) => {
      await using screen = await render(<OneGlyph size={size} />, { router: false });
      const svg = screen.container.querySelector<SVGSVGElement>("svg[data-one-glyph]");
      if (!svg) throw new Error("the glyph did not render");
      const box = svg.getBoundingClientRect();
      expect([box.width, box.height]).toEqual([size, size]);

      const geometry = oneGlyphGeometry(size);
      for (const density of [1, 2]) {
        const image = await rasterize(svg, density);
        const c = (size / 2) * density;
        // The middle of the opening is clear, so the glyph reads as a ring and not a disc.
        expect(alphaAt(image, c, c + geometry.inner.dy * density)).toBeLessThan(20);
        // The band, measured along its turned long axis, is drawn.
        const t = (-24 * Math.PI) / 180;
        const reach = (geometry.outer.rx - (geometry.outer.rx - geometry.inner.rx) / 2) * density;
        expect(alphaAt(image, c + reach * Math.cos(t), c + reach * Math.sin(t))).toBeGreaterThan(
          128,
        );
        expect(alphaAt(image, c - reach * Math.cos(t), c - reach * Math.sin(t))).toBeGreaterThan(
          128,
        );
      }
    },
  );

  it.each(ONE_GLYPH_SIZES)(
    "keeps the band at least 1.5px thick and the opening 4px or wider at %ipx",
    (size) => {
      const geometry = oneGlyphGeometry(size);
      expect(geometry.outer.rx - geometry.inner.rx).toBeGreaterThanOrEqual(1.5);
      expect(geometry.outer.ry - geometry.inner.ry).toBeGreaterThanOrEqual(1.5);
      expect(geometry.counter).toBeGreaterThanOrEqual(4);
      for (const value of [
        geometry.outer.rx,
        geometry.outer.ry,
        geometry.inner.rx,
        geometry.inner.ry,
      ]) {
        expect(value * 2).toBe(Math.round(value * 2));
      }
    },
  );

  it("draws the standard theme from the shared gold ramp", async () => {
    await using screen = await render(<OneGlyph size={16} />, { router: false });
    const svg = glyphIn(screen.container);
    const ramp = (token: string) =>
      colorOf(getComputedStyle(document.documentElement).getPropertyValue(token));
    expect(colorOf(paintOf(svg, "base"))).toEqual(ramp("--gold-500"));
    expect(colorOf(paintOf(svg, "shade"))).toEqual(ramp("--gold-700"));
    expect(colorOf(paintOf(svg, "highlight", "stroke"))).toEqual(ramp("--gold-300"));
  });

  it.each(["#b98f1f", "#d9b450", "#2f6fdd"])(
    "derives a chosen theme's tones from its action color %s: shade darker, highlight lighter, base the color",
    async (brand) => {
      document.documentElement.dataset.themeId = "chosen";
      document.documentElement.style.setProperty("--one-brand", brand);
      try {
        await using screen = await render(<OneGlyph size={16} />, { router: false });
        const svg = glyphIn(screen.container);
        const base = colorOf(paintOf(svg, "base"));
        expect(base).toEqual(colorOf(brand));
        expect(lightness(colorOf(paintOf(svg, "shade")))).toBeLessThan(lightness(base) * 0.7);
        expect(lightness(colorOf(paintOf(svg, "highlight", "stroke")))).toBeGreaterThan(
          lightness(base) * 1.2,
        );
      } finally {
        delete document.documentElement.dataset.themeId;
        document.documentElement.style.removeProperty("--one-brand");
      }
    },
  );
});
