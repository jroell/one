/**
 * Draws the static lit mark (public/mark) from the live ring's shader at its rest pose.
 * Run after any change to oneOrbShader.ts, oneOrbRest.ts or the gold ramp: `pnpm mark:render`
 * in apps/web. `--only 128` renders one CSS size. Output is lossless WebP per theme, size, density.
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { chromium } from "playwright";

import {
  ORB_GOLD,
  ORB_MARK_DENSITIES,
  ORB_MARK_SIZES,
  ORB_REST,
  ORB_SUPERSAMPLE,
  glowForSize,
  orbMarkUrl,
} from "../src/one/oneOrbRest.ts";
import { renderRestRing } from "../src/one/oneOrbRestRender.ts";
import { ONE_ORB_FRAGMENT_SHADER, ONE_ORB_VERTEX_SHADER } from "../src/one/oneOrbShader.ts";

const root = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const only = process.argv.includes("--only")
  ? Number(process.argv[process.argv.indexOf("--only") + 1])
  : null;

/** The same conversion the live ring applies to a theme color: sRGB bytes to the shader's values. */
const shaderColor = (hex) =>
  [1, 3, 5].map((at) => (parseInt(hex.slice(at, at + 2), 16) / 255) ** 2.2);

// Runs in the page: the same function the app runs for a chosen theme, then base64 for the trip back.
async function renderInPage({ source, job }) {
  const render = new Function(`return (${source})`)();
  const blob = await render(job);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage();
await page.setContent("<!doctype html><title>mark</title>");
await NodeFSP.mkdir(NodePath.resolve(root, "public/mark"), { recursive: true });

let total = 0;
for (const theme of ["dark", "light"]) {
  for (const size of ORB_MARK_SIZES) {
    if (only !== null && size !== only) continue;
    for (const density of ORB_MARK_DENSITIES) {
      const started = Date.now();
      const base64 = await page.evaluate(renderInPage, {
        source: renderRestRing.toString(),
        job: {
          vertex: ONE_ORB_VERTEX_SHADER,
          fragment: ONE_ORB_FRAGMENT_SHADER,
          width: size * density,
          supersample: ORB_SUPERSAMPLE,
          hi: shaderColor(ORB_GOLD.hi),
          mid: shaderColor(ORB_GOLD.mid),
          lo: shaderColor(ORB_GOLD.lo),
          dark: theme === "dark" ? 1 : 0,
          glow: glowForSize(size),
          rest: ORB_REST,
          quality: 1,
        },
      });
      const bytes = Buffer.from(base64, "base64");
      await NodeFSP.writeFile(
        NodePath.resolve(root, "public", orbMarkUrl(theme, size, density).slice(1)),
        bytes,
      );
      total += bytes.length;
      console.log(
        `${theme} ${size}px @${density}x ${(bytes.length / 1024).toFixed(1)} KB ${Date.now() - started} ms`,
      );
    }
  }
}
console.log(`wrote ${(total / 1024).toFixed(0)} KB to public/mark`);
await browser.close();
