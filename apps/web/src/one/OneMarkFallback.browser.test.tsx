import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../test/render";
import { OneMark } from "./OneMark";
import { OneOrb } from "./OneOrb";

/** Puts the page in a chosen theme for one test and takes it out again. */
function chosenTheme(): Disposable {
  const html = document.documentElement;
  html.dataset.themeId = "chosen";
  html.style.setProperty("--app-theme-message-action", "#7a3df0");
  return {
    [Symbol.dispose]: () => {
      delete html.dataset.themeId;
      html.style.removeProperty("--app-theme-message-action");
    },
  };
}

/** WebGL that cannot be created, or whose shaders do not compile: the two ways the picture fails. */
function brokenWebgl(how: "no context" | "shader failure"): Disposable {
  if (how === "no context") {
    const original = HTMLCanvasElement.prototype.getContext;
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
      this: HTMLCanvasElement,
      ...args: unknown[]
    ) {
      return args[0] === "webgl"
        ? null
        : (original as (...a: unknown[]) => unknown).apply(this, args);
    } as never);
    return { [Symbol.dispose]: () => spy.mockRestore() };
  }
  const spy = vi
    .spyOn(WebGLRenderingContext.prototype, "getShaderParameter")
    .mockReturnValue(false);
  return { [Symbol.dispose]: () => spy.mockRestore() };
}

/** How many pixels in the element's box differ from the box's corner, which is page background. */
async function paintedPixels(element: Element): Promise<number> {
  const base64 = await page.screenshot({ element, base64: true, save: false });
  const picture = new Image();
  picture.src = `data:image/png;base64,${base64}`;
  await picture.decode();
  const canvas = document.createElement("canvas");
  canvas.width = picture.naturalWidth;
  canvas.height = picture.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d context");
  context.drawImage(picture, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let painted = 0;
  for (let at = 0; at < data.length; at += 4) {
    const distance =
      Math.abs((data[at] ?? 0) - (data[0] ?? 0)) +
      Math.abs((data[at + 1] ?? 0) - (data[1] ?? 0)) +
      Math.abs((data[at + 2] ?? 0) - (data[2] ?? 0));
    if (distance > 60) painted += 1;
  }
  return painted;
}

describe("the mark in a chosen theme when WebGL cannot draw its picture", () => {
  it.each(["no context", "shader failure"] as const)(
    "paints the vector ring in its box on a mark of its own: %s",
    async (how) => {
      using _theme = chosenTheme();
      using _broken = brokenWebgl(how);
      await using screen = await render(
        <div style={{ padding: 8, background: "white" }}>
          <OneMark size={128} style={{ width: 128, height: 128 }} />
        </div>,
        { router: false },
      );
      const mark = screen.container.querySelector("[data-one-mark]");
      if (!mark) throw new Error("the mark did not render");
      await vi.waitFor(() =>
        expect(mark.querySelector("svg[data-one-mark-vector]")).not.toBeNull(),
      );
      expect(mark.querySelector("img")).toBeNull();
      expect(await paintedPixels(mark)).toBeGreaterThan(1500);
    },
  );

  it("paints the vector ring in the orb's box after the orb loses its WebGL", async () => {
    using _theme = chosenTheme();
    using _broken = brokenWebgl("shader failure");
    await using screen = await render(
      <div style={{ width: 128, background: "white" }}>
        <OneOrb />
      </div>,
      { router: false },
    );
    const mark = await vi.waitFor(
      () => {
        const found = screen.container.querySelector("[data-one-mark]");
        expect(found).not.toBeNull();
        return found as Element;
      },
      { timeout: 8000 },
    );
    await vi.waitFor(() => expect(mark.querySelector("svg[data-one-mark-vector]")).not.toBeNull());
    expect(await paintedPixels(mark)).toBeGreaterThan(1500);
  });
});
