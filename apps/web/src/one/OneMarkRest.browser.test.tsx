import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { render } from "../../test/render";
import { OneOrb } from "./OneOrb";
import {
  orbMarkUrl,
  ORB_GOLD,
  ORB_OPEN_ANGLE,
  ORB_REST,
  glowForSize,
  type OrbMarkSize,
} from "./oneOrbRest";
import { renderRestRing } from "./oneOrbRestRender";
import { ONE_ORB_FRAGMENT_SHADER, ONE_ORB_VERTEX_SHADER } from "./oneOrbShader";

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

describe("the ring's glow level", () => {
  async function drawAtLevel(level: number) {
    using _still = stillMotion();
    using _readable = readableWebgl();
    using _mode = themeMode("dark");
    await using screen = await render(
      <div style={{ width: 320 }}>
        <OneOrb glowLevelRef={{ current: level }} />
      </div>,
      { router: false },
    );
    const canvas = screen.container.querySelector("canvas");
    if (!canvas) throw new Error("the ring has no canvas");
    await vi.waitFor(
      () =>
        expect(premultiplied(canvas, 320).some((value, at) => at % 4 === 3 && value > 0)).toBe(
          true,
        ),
      { timeout: 8000 },
    );
    return premultiplied(canvas, 320);
  }
  const solid = (pixels: Uint8ClampedArray) =>
    Array.from({ length: pixels.length / 4 }, (_, index) => (pixels[index * 4 + 3] ?? 0) >= 250);
  const light = (pixels: Uint8ClampedArray) =>
    pixels.reduce((sum, value, at) => (at % 4 === 3 ? sum : sum + value), 0);

  it("lights the rim and halo and leaves the ring's silhouette exactly as it was", async () => {
    const quiet = await drawAtLevel(0);
    const loud = await drawAtLevel(1);
    expect(solid(loud)).toEqual(solid(quiet));
    expect(solid(quiet).filter(Boolean).length).toBeGreaterThan(1000);
    expect(light(loud)).toBeGreaterThan(light(quiet) * 1.02);
  });
});

describe("the waiting sweep of light", () => {
  const linear = (hex: string) =>
    [1, 3, 5].map((at) => (Number.parseInt(hex.slice(at, at + 2), 16) / 255) ** 2.2);
  /** The waiting ring, held edge-on, at the voice stage's size, drawn at `time` seconds. */
  async function waitingRing(sweep: number, time: number) {
    const width = 256;
    const blob = await renderRestRing({
      vertex: ONE_ORB_VERTEX_SHADER,
      fragment: ONE_ORB_FRAGMENT_SHADER,
      width,
      supersample: 1,
      hi: linear(ORB_GOLD.hi),
      mid: linear(ORB_GOLD.mid),
      lo: linear(ORB_GOLD.lo),
      dark: 1,
      glow: glowForSize(width),
      rest: {
        ...ORB_REST,
        time,
        spin: ORB_OPEN_ANGLE + Math.PI / 2,
        tilt: 1.12,
        aura: 0.3,
      },
      quality: 1,
      sweep,
    });
    return premultiplied(await createImageBitmap(blob), width);
  }
  const changedPixels = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
    let count = 0;
    for (let at = 0; at < a.length; at += 4) {
      const largest = Math.max(
        Math.abs((a[at] ?? 0) - (b[at] ?? 0)),
        Math.abs((a[at + 1] ?? 0) - (b[at + 1] ?? 0)),
        Math.abs((a[at + 2] ?? 0) - (b[at + 2] ?? 0)),
      );
      if (largest > 24) count += 1;
    }
    return count;
  };

  it("is plainly visible on the edge-on ring at 256px: half a second later the light is somewhere else, with the sweep on and not with it off", async () => {
    const early = await waitingRing(1, 0);
    const later = await waitingRing(1, 0.5);
    expect(changedPixels(early, later)).toBeGreaterThan(40);
    expect(changedPixels(await waitingRing(0, 0), await waitingRing(0, 0.5))).toBe(0);
  });
});
