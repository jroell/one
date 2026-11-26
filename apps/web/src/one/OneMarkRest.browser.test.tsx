import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { render } from "../../test/render";
import { OneOrb } from "./OneOrb";
import { orbMarkUrl, type OrbMarkSize } from "./oneOrbRest";

/** Reduced motion draws the ring's rest pose once, which is what the static mark shows. */
function stillMotion(): Disposable {
  const original = window.matchMedia.bind(window);
  return vi
    .spyOn(window, "matchMedia")
    .mockImplementation((query) =>
      original(query.includes("prefers-reduced-motion") ? "(min-width: 0px)" : query),
    );
}

/** Keeps the ring's pixels readable after the frame, so the test can compare them with the picture. */
function readableWebgl(): Disposable {
  const original = HTMLCanvasElement.prototype.getContext;
  const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
    ...args: unknown[]
  ) {
    const [type, attributes] = args as [string, WebGLContextAttributes | undefined];
    const wanted = type === "webgl" ? { ...attributes, preserveDrawingBuffer: true } : attributes;
    return (original as (...a: unknown[]) => unknown).call(this, type, wanted);
  } as never);
  return { [Symbol.dispose]: () => spy.mockRestore() };
}

/** RGBA with color multiplied by alpha, so edge pixels compare by what they contribute. */
function premultiplied(source: CanvasImageSource, width: number): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = width;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d context");
  context.imageSmoothingQuality = "low";
  context.drawImage(source, 0, 0, width, width);
  const data = context.getImageData(0, 0, width, width).data;
  const out = new Uint8ClampedArray(data.length);
  for (let at = 0; at < data.length; at += 4) {
    const alpha = (data[at + 3] ?? 0) / 255;
    out[at] = (data[at] ?? 0) * alpha;
    out[at + 1] = (data[at + 1] ?? 0) * alpha;
    out[at + 2] = (data[at + 2] ?? 0) * alpha;
    out[at + 3] = data[at + 3] ?? 0;
  }
  return out;
}

/** Puts the page in a theme mode for one test and takes it out again. */
function themeMode(mode: "dark" | "light"): Disposable {
  document.documentElement.classList.toggle("dark", mode === "dark");
  return { [Symbol.dispose]: () => document.documentElement.classList.remove("dark") };
}

describe("the static mark and the live ring at rest", () => {
  it.each([
    ["light", 64],
    ["light", 128],
    ["dark", 96],
    ["dark", 256],
  ] as const)(
    "draw the same pixels in the %s theme at %spx, to within 3 of 255 per channel",
    async (theme, size) => {
      using _still = stillMotion();
      using _readable = readableWebgl();
      using _mode = themeMode(theme);
      await using screen = await render(
        <div style={{ width: size }}>
          <OneOrb />
        </div>,
        { router: false },
      );
      const canvas = screen.container.querySelector("canvas");
      if (!canvas) throw new Error("the ring has no canvas");
      const picture = new Image();
      picture.src = orbMarkUrl(theme, size as OrbMarkSize, window.devicePixelRatio >= 2 ? 2 : 1);
      await picture.decode();

      const width = Math.round(size * (window.devicePixelRatio >= 2 ? 2 : 1));
      // The ring draws on its first frame, once it is in view.
      await vi.waitFor(
        () => {
          const live = premultiplied(canvas, width);
          expect(live.some((value, at) => at % 4 === 3 && value > 0)).toBe(true);
        },
        { timeout: 8000 },
      );
      const live = premultiplied(canvas, width);
      const still = premultiplied(picture, width);
      let largest = 0;
      for (let at = 0; at < live.length; at += 1) {
        largest = Math.max(largest, Math.abs((live[at] ?? 0) - (still[at] ?? 0)));
      }
      expect(largest).toBeLessThanOrEqual(3);
    },
  );
});
