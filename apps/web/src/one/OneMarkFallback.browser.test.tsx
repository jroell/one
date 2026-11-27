import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../test/render";
import { OneMark } from "./OneMark";
import { OneOrb } from "./OneOrb";

/** WebGL whose shaders do not compile: the live ring cannot draw. */
function brokenWebgl(): Disposable {
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

it("the orb's stand-in paints the gold ring in its box when the live ring cannot draw", async () => {
  using _broken = brokenWebgl();
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
  await vi.waitFor(async () => expect(await paintedPixels(mark)).toBeGreaterThan(1500), {
    timeout: 8000,
  });
});

it("a missing picture hands the mark to the vector ring, which paints", async () => {
  await using screen = await render(
    <div style={{ padding: 8, background: "white" }}>
      <OneMark size={128} style={{ width: 128, height: 128 }} />
    </div>,
    { router: false },
  );
  const mark = screen.container.querySelector("[data-one-mark]");
  if (!mark) throw new Error("the mark did not render");
  for (const picture of mark.querySelectorAll("img")) picture.dispatchEvent(new Event("error"));
  await vi.waitFor(() => expect(mark.querySelector("svg[data-one-mark-vector]")).not.toBeNull());
  expect(mark.querySelector("img")).toBeNull();
  expect(await paintedPixels(mark)).toBeGreaterThan(1500);
});

it("the mark casts the shared halo above 40px, sized from its own width", async () => {
  await using wide = await render(<OneMark size={176} />, { router: false });
  const big = wide.container.querySelector<HTMLElement>("[data-one-mark]")!;
  expect(big.classList.contains("one-ring-halo")).toBe(true);
  expect(big.style.getPropertyValue("--ring-size")).toBe("176px");
  expect(getComputedStyle(big).filter).not.toBe("none");

  await using small = await render(<OneMark size={48} />, { router: false });
  const mid = small.container.querySelector<HTMLElement>("[data-one-mark]")!;
  expect(mid.style.getPropertyValue("--ring-size")).toBe("48px");
  expect(getComputedStyle(mid).filter).not.toBe("none");
});
