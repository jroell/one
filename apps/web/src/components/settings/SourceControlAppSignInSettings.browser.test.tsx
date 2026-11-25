import { describe, expect, it } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";
import { AppMark } from "./SourceControlAppSignInSettings";

function channels(css: string): [number, number, number] {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

function luminance([r, g, b]: [number, number, number]) {
  const linear = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(channels(a)), luminance(channels(b))].toSorted((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("source control app mark", () => {
  it.each(["light", "dark"] as const)(
    "the signed-in check is at least 4.5:1 against its fill in %s",
    async (scheme) => {
      document.documentElement.classList.toggle("dark", scheme === "dark");
      try {
        await using screen = await render(<AppMark signedIn />, { router: false });
        const marker = screen.container.querySelector<HTMLElement>("span.rounded-full")!;
        const style = getComputedStyle(marker);
        expect(contrast(style.color, style.backgroundColor)).toBeGreaterThanOrEqual(4.5);
      } finally {
        document.documentElement.classList.remove("dark");
      }
    },
  );
});
