// @effect-diagnostics nodeBuiltinImport:off - reads the images and the stylesheet on disk.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

import {
  ORB_GOLD,
  ORB_MARK_DENSITIES,
  ORB_MARK_MONO_URL,
  ORB_MARK_SIZES,
  orbMarkUrl,
} from "./oneOrbRest";

const web = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "../..");

/** Pixel size read from a WebP file's header, for the lossless (VP8L) and extended (VP8X) forms. */
function webpSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
  expect(bytes.toString("ascii", 8, 12)).toBe("WEBP");
  const form = bytes.toString("ascii", 12, 16);
  if (form === "VP8X") {
    return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  }
  expect(form, "the mark must be lossless so it matches the live ring").toBe("VP8L");
  const bits = bytes.readUInt32LE(21);
  return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
}

describe("the static mark images in public/mark", () => {
  const combinations = (["dark", "light"] as const).flatMap((theme) =>
    ORB_MARK_SIZES.flatMap((size) =>
      ORB_MARK_DENSITIES.map((density) => [theme, size, density] as const),
    ),
  );

  it.each(combinations)(
    "has a lossless %s picture at %spx and %sx with the pixel size the component asks for",
    (theme, size, density) => {
      const file = NodePath.join(web, "public", orbMarkUrl(theme, size, density));
      const { width, height } = webpSize(NodeFS.readFileSync(file));
      expect([width, height]).toEqual([size * density, size * density]);
    },
  );

  it("is drawn from the gold ramp the stylesheet publishes, so the picture and the UI share one metal", () => {
    const css = NodeFS.readFileSync(NodePath.join(web, "src/one/one-ui.css"), "utf8");
    const token = (step: number) =>
      new RegExp(`--gold-${step}:\\s*(#[0-9a-f]{6})`, "i").exec(css)?.[1]?.toLowerCase();
    expect([ORB_GOLD.hi, ORB_GOLD.mid, ORB_GOLD.lo]).toEqual([token(300), token(500), token(700)]);
  });

  it("was drawn by the current shader, rest pose and script, and every file is the one the script wrote", () => {
    const sha256 = (file: string) =>
      NodeCrypto.createHash("sha256")
        .update(NodeFS.readFileSync(NodePath.join(web, file)))
        .digest("hex");
    const manifest = JSON.parse(
      NodeFS.readFileSync(NodePath.join(web, "public/mark/manifest.json"), "utf8"),
    ) as { inputs: Record<string, string>; files: Record<string, string> };
    const stale = Object.entries(manifest.inputs)
      .filter(([file, hash]) => sha256(file) !== hash)
      .map(([file]) => file);
    expect(
      stale,
      "run `pnpm mark:render` in apps/web: these inputs changed since the pictures were drawn",
    ).toEqual([]);
    const expected = [
      ORB_MARK_MONO_URL.slice(1),
      ...combinations.map(([theme, size, density]) => orbMarkUrl(theme, size, density).slice(1)),
    ];
    expect(Object.keys(manifest.files).sort()).toEqual([...expected].sort());
    const changed = expected.filter((name) => sha256(`public/${name}`) !== manifest.files[name]);
    expect(changed, "run `pnpm mark:render` in apps/web without --only").toEqual([]);
  });

  it("has a one-color ring that is a single black shape, so a system can template it", () => {
    const svg = NodeFS.readFileSync(NodePath.join(web, "public", ORB_MARK_MONO_URL), "utf8");
    expect(svg.match(/<path/g)).toHaveLength(1);
    expect(svg).not.toMatch(/fill="#|stroke|gradient/i);
  });
});
