import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { render } from "../../test/render";
import { OneMark } from "./OneMark";
import { OneOrb } from "./OneOrb";

/** Reduced motion draws the ring's rest pose once, which is what the picture shows. */
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

function pixels(source: CanvasImageSource, width: number): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = width;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d context");
  context.imageSmoothingQuality = "low";
  context.drawImage(source, 0, 0, width, width);
  return context.getImageData(0, 0, width, width).data;
}

/** Puts the page in a chosen theme and mode for one test and takes it out again. */
function chosenTheme(mode: "dark" | "light", action: string): Disposable {
  const html = document.documentElement;
  html.classList.toggle("dark", mode === "dark");
  html.dataset.themeId = "chosen";
  html.style.setProperty("--app-theme-message-action", action);
  return {
    [Symbol.dispose]: () => {
      html.classList.remove("dark");
      delete html.dataset.themeId;
      html.style.removeProperty("--app-theme-message-action");
    },
  };
}

/** How far the picture drawn for a theme is from the live ring in the same theme, over the ring's solid pixels. */
async function differences(mode: "dark" | "light", action: string) {
  using _still = stillMotion();
  using _readable = readableWebgl();
  using _theme = chosenTheme(mode, action);
  await using screen = await render(
    <div style={{ display: "flex" }}>
      <div style={{ width: 128 }}>
        <OneOrb />
      </div>
      <OneMark size={128} style={{ width: 128, height: 128 }} />
    </div>,
    { router: false },
  );
  const canvas = screen.container.querySelector("canvas");
  if (!canvas) throw new Error("the ring has no canvas");
  const width = 128 * Math.round(window.devicePixelRatio || 1);
  let picture: HTMLImageElement | null = null;
  await vi.waitFor(
    () => {
      picture = screen.container.querySelector<HTMLImageElement>("img[data-mark-tinted]");
      expect(picture).not.toBeNull();
      expect(pixels(canvas, width).some((value, at) => at % 4 === 3 && value > 0)).toBe(true);
    },
    { timeout: 8000 },
  );
  await picture!.decode();
  const live = pixels(canvas, width);
  const still = pixels(picture!, width);
  const errors: number[] = [];
  for (let at = 0; at < live.length; at += 4) {
    if ((live[at + 3] ?? 0) < 250 || (still[at + 3] ?? 0) < 250) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      errors.push(Math.abs((live[at + channel] ?? 0) - (still[at + channel] ?? 0)));
    }
  }
  errors.sort((a, b) => a - b);
  return { largest: errors.at(-1) ?? 0, solid: errors.length / 3 };
}

describe("the picture drawn for a chosen theme and the live ring", () => {
  it.each([
    ["dark", "oklch(0.793363 0.105022 199.893)"],
    ["light", "oklch(0.516323 0.161628 24.82)"],
    ["dark", "#7a3df0"],
    ["light", "#2f8f4e"],
  ] as const)(
    "draw the same pixels in the %s theme with action color %s, to within 3 of 255 per channel",
    async (mode, action) => {
      const result = await differences(mode, action);
      expect(result.solid).toBeGreaterThan(1000);
      expect(result.largest).toBeLessThanOrEqual(3);
    },
  );
});
