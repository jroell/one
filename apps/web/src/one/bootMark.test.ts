// @effect-diagnostics nodeBuiltinImport:off - reads index.html on disk.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

import { ONE_MARK_LIT_AXIS, ONE_MARK_LIT_STOPS, ONE_MARK_PATHS } from "./oneMarkPaths";
import { ORB_MARK_DENSITIES, orbMarkUrl } from "./oneOrbRest";

const html = NodeFS.readFileSync(
  NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "../../index.html"),
  "utf8",
);

const boot = html.slice(html.indexOf('id="boot-shell-logo"'), html.indexOf('id="boot-shell-name"'));

describe("boot screen mark", () => {
  it("draws every outline the One mark draws, so the two cannot drift apart", () => {
    for (const [name, outline] of Object.entries(ONE_MARK_PATHS)) {
      expect(boot, `boot screen is missing the ${name} outline`).toContain(outline);
    }
  });

  it("lights the band along the axis and with the stops the One mark uses", () => {
    const gradient = boot.slice(boot.indexOf('id="boot-band"'), boot.indexOf("</linearGradient>"));
    const attribute = (name: string) =>
      Number(new RegExp(`${name}="([\\d.]+)"`).exec(gradient)?.[1]);
    expect([attribute("x1"), attribute("y1"), attribute("x2"), attribute("y2")]).toEqual([
      ONE_MARK_LIT_AXIS.x1,
      ONE_MARK_LIT_AXIS.y1,
      ONE_MARK_LIT_AXIS.x2,
      ONE_MARK_LIT_AXIS.y2,
    ]);
    const stops = [
      ...gradient.matchAll(/offset="([\d.]+)" style="stop-color: var\(--boot-ring-(\w+)\)"/g),
    ].map((match) => [Number(match[1]), match[2]]);
    expect(stops).toEqual(ONE_MARK_LIT_STOPS.map(([offset, tone]) => [offset, tone]));
  });

  it("puts the glint at one o'clock in white, as the One mark does", () => {
    expect(boot).toContain(`d="${ONE_MARK_PATHS.glint}"\n                fill="#fff"`);
  });

  it("fades its glow to nothing with no hard step at the edge", () => {
    const start = html.indexOf("#boot-shell-card::before");
    const glow = html.slice(start, html.indexOf("transparent 100%", start));
    const alphas = [...glow.matchAll(/rgb\(0 0 0 \/ (\d+)%\)/g)].map((match) => Number(match[1]));
    expect(alphas.length).toBeGreaterThan(6);
    expect(alphas).toEqual([...alphas].sort((a, b) => b - a));
    expect(alphas.at(-1)).toBeLessThanOrEqual(1);
  });

  it.each(["dark", "light"] as const)(
    "shows the same %s picture of the ring that the One mark and the live ring at rest show",
    (theme) => {
      const image = new RegExp(`<img[^>]*data-mark-theme="${theme}"[^>]*>`).exec(html)?.[0] ?? "";
      expect(image).toContain(`src="${orbMarkUrl(theme, 112, 1)}"`);
      const srcset = /srcset="([^"]*)"/.exec(image)?.[1]?.replace(/\s+/g, " ").trim();
      expect(srcset).toBe(
        ORB_MARK_DENSITIES.map((density) => `${orbMarkUrl(theme, 112, density)} ${density}x`).join(
          ", ",
        ),
      );
    },
  );

  it("recolors the gold picture for a chosen theme in an inline script, with no module of its own", () => {
    expect(html).not.toMatch(/<script type="module" src="\/src\/one\//);
    expect(html).toContain("const ringTintTable");
    expect(html).toContain(".boot-ring-image:not([data-tinted])");
  });
});
