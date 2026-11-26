import { describe, expect, it } from "vite-plus/test";

import "~/index.css";
import { STANDARD_THEME_CARDS, STANDARD_TILE_MATERIAL } from "./ThemePreviewCircles";

function channels(css: string): [number, number, number] {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

/** What the page paints for a token in the current mode, as 8-bit channels. */
function resolved(token: string): [number, number, number] {
  const probe = document.createElement("div");
  probe.style.backgroundColor = `var(${token})`;
  document.body.append(probe);
  try {
    return channels(getComputedStyle(probe).backgroundColor);
  } finally {
    probe.remove();
  }
}

describe("the default theme's tiles", () => {
  it.each(["light", "dark"] as const)("draw the surfaces and gold the app paints in %s", (mode) => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    try {
      const material = STANDARD_TILE_MATERIAL[mode];
      const expected = {
        base: "--m-base",
        raised: "--m-raised",
        card: "--m-card",
        floating: "--m-floating",
        brand: "--m-brand-default",
      } as const;
      for (const [role, token] of Object.entries(expected)) {
        const tile = channels(material[role as keyof typeof expected]);
        const actual = resolved(token);
        const difference = Math.max(
          ...tile.map((channel, index) => Math.abs(channel - actual[index]!)),
        );
        expect(difference, `${mode} ${role} against ${token}`).toBeLessThanOrEqual(1);
      }
    } finally {
      document.documentElement.classList.remove("dark");
    }
  });

  it("uses those surfaces for the roles a tile draws", () => {
    const dark = STANDARD_THEME_CARDS[0]!.previews.find((preview) => preview.mode === "dark")!;
    expect(dark.colors).toMatchObject({
      canvas: STANDARD_TILE_MATERIAL.dark.base,
      sidebar: STANDARD_TILE_MATERIAL.dark.base,
      surface: STANDARD_TILE_MATERIAL.dark.raised,
      accent: STANDARD_TILE_MATERIAL.dark.brand,
    });
  });
});
