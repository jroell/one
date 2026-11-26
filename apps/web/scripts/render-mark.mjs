/**
 * Draws the static lit mark (public/mark) from the live ring's shader at its rest pose, and
 * stamps manifest.json with input and output hashes (markImages.test.ts checks them).
 * Run `pnpm mark:render` in apps/web after changing the shader, rest pose or gold ramp.
 * `--only 128` renders one CSS size and leaves the manifest alone.
 */ import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { chromium } from "playwright";

import {
  ORB_GOLD,
  ORB_MARK_DENSITIES,
  ORB_MARK_MONO_URL,
  ORB_MARK_SIZES,
  ORB_REST,
  ORB_SUPERSAMPLE,
  glowForSize,
  orbMarkUrl,
} from "../src/one/oneOrbRest.ts";
import { oneGlyphGeometry } from "../src/one/oneGlyphGeometry.ts";
import { renderRestRing } from "../src/one/oneOrbRestRender.ts";
import { ONE_ORB_FRAGMENT_SHADER, ONE_ORB_VERTEX_SHADER } from "../src/one/oneOrbShader.ts";

/** The files the pictures depend on; the manifest records their hashes. */
const MARK_INPUTS = [
  "src/one/oneOrbShader.ts",
  "src/one/oneOrbRest.ts",
  "src/one/oneOrbRestRender.ts",
  "src/one/oneGlyphGeometry.ts",
  "scripts/render-mark.mjs",
];

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
// The one-colour ring: the glyph's silhouette at 24px, black so a system can template it.
const mono = oneGlyphGeometry(24);
await NodeFSP.writeFile(
  NodePath.resolve(root, "public", ORB_MARK_MONO_URL.slice(1)),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill-rule="evenodd" transform="rotate(${mono.tilt} 12 12)" d="${mono.paths.band}"/></svg>\n`,
);
console.log(`wrote ${(total / 1024).toFixed(0)} KB to public/mark`);

const sha256 = async (file) =>
  NodeCrypto.createHash("sha256")
    .update(await NodeFSP.readFile(NodePath.resolve(root, file)))
    .digest("hex");
if (only === null) {
  const inputs = {};
  for (const file of MARK_INPUTS) inputs[file] = await sha256(file);
  const files = {
    [ORB_MARK_MONO_URL.slice(1)]: await sha256(NodePath.join("public", ORB_MARK_MONO_URL.slice(1))),
  };
  for (const theme of ["dark", "light"]) {
    for (const size of ORB_MARK_SIZES) {
      for (const density of ORB_MARK_DENSITIES) {
        const name = orbMarkUrl(theme, size, density).slice(1);
        files[name] = await sha256(NodePath.join("public", name));
      }
    }
  }
  await NodeFSP.writeFile(
    NodePath.resolve(root, "public/mark/manifest.json"),
    `${JSON.stringify({ inputs, files }, null, 2)}\n`,
  );
  console.log("stamped public/mark/manifest.json");
} else {
  console.log("partial run: manifest.json not updated");
}
await browser.close();
