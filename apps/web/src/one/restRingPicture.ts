/**
 * The ring's rest pose for a chosen theme, drawn by the same shader and function that wrote the
 * gold pictures (oneOrbRestRender.ts), so it is the live ring's own pixels. One picture per
 * color, mode, size and density is drawn and kept.
 */
import { ORB_REST, ORB_SUPERSAMPLE, glowForSize, type OrbMarkSize } from "./oneOrbRest";
import { renderRestRing } from "./oneOrbRestRender";
import { ONE_ORB_FRAGMENT_SHADER, ONE_ORB_VERTEX_SHADER } from "./oneOrbShader";

let probe: CanvasRenderingContext2D | null | undefined;

/** A CSS color as the shader's values: sRGB bytes raised to 2.2, as the live ring reads them. */
function shaderColor(css: string): number[] {
  if (probe === undefined) {
    probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (probe) {
      probe.canvas.width = 1;
      probe.canvas.height = 1;
    }
  }
  if (!probe) return [0.5, 0.3, 0.05];
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = css;
  probe.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = probe.getImageData(0, 0, 1, 1).data;
  return [r, g, b].map((byte) => (byte / 255) ** 2.2);
}

const pictures = new Map<string, Promise<string>>();

/** An object URL for the rest-pose ring in these colors (any CSS color syntax: shadow, mid, light). */
export function restRingUrl(input: {
  readonly lo: string;
  readonly mid: string;
  readonly hi: string;
  readonly dark: boolean;
  readonly size: OrbMarkSize;
  readonly density: number;
}): Promise<string> {
  const key = JSON.stringify(input);
  let url = pictures.get(key);
  if (!url) {
    const job = {
      vertex: ONE_ORB_VERTEX_SHADER,
      fragment: ONE_ORB_FRAGMENT_SHADER,
      width: input.size * input.density,
      supersample: ORB_SUPERSAMPLE,
      hi: shaderColor(input.hi),
      mid: shaderColor(input.mid),
      lo: shaderColor(input.lo),
      dark: input.dark ? 1 : 0,
      glow: glowForSize(input.size),
      rest: ORB_REST,
      quality: 1,
    };
    url = renderRestRing(job).then((blob) => URL.createObjectURL(blob));
    pictures.set(key, url);
    url.catch(() => pictures.delete(key));
  }
  return url;
}
