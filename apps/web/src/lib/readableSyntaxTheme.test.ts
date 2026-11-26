import { describe, expect, it } from "vite-plus/test";

import { getResolvedOrResolveTheme } from "@pierre/diffs";

import { ONE_DARK_THEME_NAME, ONE_LIGHT_PALETTE, ONE_LIGHT_THEME_NAME } from "./oneSyntaxTheme";
import { readableOnLightCode } from "./readableSyntaxTheme";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  return (luminance(background) + 0.05) / (luminance(foreground) + 0.05);
}

// pierre-light's faintest syntax colors: yellow, cyan, orange, teal, green, pink.
const PIERRE_LIGHT_FAINT = ["#d5a910", "#08c0ef", "#d5901c", "#1ca1c7", "#199f43", "#d32a61"];
// Light code surfaces: the code background, added and deleted lines, and changed words on each.
const LIGHT_CODE_SURFACES = ["#fcfcfc", "#ecf9f4", "#fef0f0", "#ccecdf", "#f8d3d4"];

describe("readableOnLightCode", () => {
  it("brings pierre-light's faint colors to 4.5:1 on every light code surface", () => {
    for (const color of PIERRE_LIGHT_FAINT) {
      for (const surface of LIGHT_CODE_SURFACES) {
        expect(contrast(readableOnLightCode(color), surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("holds 4.5:1 on every light code surface in the One light palette", () => {
    for (const [role, color] of Object.entries(ONE_LIGHT_PALETTE)) {
      for (const surface of LIGHT_CODE_SURFACES) {
        expect(contrast(color, surface), `${role} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("holds 4.5:1 on every light code surface for every token color the resolved One light theme can emit, diff fences included", async () => {
    const theme = await getResolvedOrResolveTheme(ONE_LIGHT_THEME_NAME, "highlights");
    const colors = Object.entries(theme.zed?.style.syntax ?? {}).flatMap(([scope, style]) => {
      const color = typeof style === "string" ? style : style.color;
      return color === undefined ? [] : [{ scope, color }];
    });
    if (theme.fg !== undefined) colors.push({ scope: "plain text", color: theme.fg });
    expect(colors.map((entry) => entry.scope)).toEqual(
      expect.arrayContaining(["diff.plus", "diff.minus", "diff.delta"]),
    );
    for (const { scope, color } of colors) {
      for (const surface of LIGHT_CODE_SURFACES) {
        expect(
          contrast(color.slice(0, 7), surface),
          `${scope} ${color} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("gives Shiki the One themes too, with the same palette and the same 4.5:1 floor on light", async () => {
    const dark = await getResolvedOrResolveTheme(ONE_DARK_THEME_NAME, "shiki-js");
    const keyword = dark.textmate?.settings?.find((rule) => rule.scope === "keyword");
    expect(keyword?.settings.foreground).toBe("#ddb55a");

    const light = await getResolvedOrResolveTheme(ONE_LIGHT_THEME_NAME, "shiki-js");
    const rules = light.textmate?.settings ?? [];
    expect(rules.find((rule) => rule.scope === "keyword")?.settings.foreground).toBe(
      ONE_LIGHT_PALETTE.keyword,
    );
    const foregrounds = rules.flatMap((rule) =>
      rule.scope === undefined || rule.settings.foreground === undefined
        ? []
        : [{ scope: String(rule.scope), color: rule.settings.foreground }],
    );
    expect(foregrounds.length).toBeGreaterThan(100);
    for (const { scope, color } of foregrounds) {
      for (const surface of LIGHT_CODE_SURFACES) {
        expect(
          contrast(color.slice(0, 7), surface),
          `${scope} ${color} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("leaves colors that already read unchanged", () => {
    expect(readableOnLightCode("#693acf")).toBe("#693acf");
    expect(readableOnLightCode("#0a0a0a")).toBe("#0a0a0a");
  });

  it("keeps an alpha suffix and ignores non-hex values", () => {
    expect(readableOnLightCode("#d5a91080")).toMatch(/80$/);
    expect(readableOnLightCode("var(--x)")).toBe("var(--x)");
  });
});
