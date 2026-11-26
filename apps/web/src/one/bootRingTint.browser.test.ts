import indexHtml from "../../index.html?raw";
import { describe, expect, it } from "vite-plus/test";

import { holdRestRing } from "./restRingPicture";

/** The boot screen's two inline functions, taken from index.html as they run before the app loads. */
function bootTint() {
  const start = indexHtml.indexOf("const ringTintTable");
  const code = indexHtml.slice(start, indexHtml.indexOf("(async () => {", start));
  return new Function(`${code}; return { ringTintTable, tintRing };`)() as {
    ringTintTable: (source: number[][], target: number[][]) => Uint8ClampedArray;
    tintRing: (pixels: Uint8ClampedArray, table: Uint8ClampedArray) => void;
  };
}

function rgb(css: string): number[] {
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d context");
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
}

async function pixelsOf(url: string): Promise<{ data: Uint8ClampedArray; width: number }> {
  const picture = new Image();
  picture.src = url;
  await picture.decode();
  const canvas = document.createElement("canvas");
  canvas.width = picture.naturalWidth;
  canvas.height = picture.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d context");
  context.drawImage(picture, 0, 0);
  return {
    data: context.getImageData(0, 0, canvas.width, canvas.height).data,
    width: canvas.width,
  };
}

describe("the boot screen's recolored ring against the ring drawn by the shader", () => {
  it.each([
    ["dark", "oklch(0.793363 0.105022 199.893)"],
    ["light", "oklch(0.516323 0.161628 24.82)"],
    ["dark", "#7a3df0"],
    ["light", "#2f8f4e"],
  ] as const)(
    "stays within a mean of 20 and a 99th percentile of 60 of 255 per channel in the %s theme with action color %s",
    async (mode, action) => {
      const ring = {
        lo: `color-mix(in oklch, ${action} 60%, black)`,
        mid: action,
        hi: `color-mix(in oklch, ${action} 36%, white)`,
      };
      const exact = await pixelsOf(
        await holdRestRing({ ...ring, dark: mode === "dark", size: 112, density: 1 }).picture,
      );
      const gold = await pixelsOf(`/mark/ring-${mode}-112@1x.webp`);
      const boot = bootTint();
      boot.tintRing(
        gold.data,
        boot.ringTintTable(
          [
            [110, 81, 24],
            [194, 151, 58],
            [241, 213, 138],
          ],
          [rgb(ring.lo), rgb(ring.mid), rgb(ring.hi)],
        ),
      );
      const errors: number[] = [];
      for (let at = 0; at < gold.data.length; at += 4) {
        if ((gold.data[at + 3] ?? 0) < 250 || (exact.data[at + 3] ?? 0) < 250) continue;
        for (let channel = 0; channel < 3; channel += 1) {
          errors.push(Math.abs((gold.data[at + channel] ?? 0) - (exact.data[at + channel] ?? 0)));
        }
      }
      errors.sort((a, b) => a - b);
      const mean = errors.reduce((sum, value) => sum + value, 0) / errors.length;
      expect(errors.length / 3).toBeGreaterThan(1000);
      expect(mean).toBeLessThanOrEqual(20);
      expect(errors[Math.floor(errors.length * 0.99)] ?? 0).toBeLessThanOrEqual(60);
    },
  );
});
