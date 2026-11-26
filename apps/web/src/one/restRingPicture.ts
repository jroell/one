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

interface Entry {
  readonly picture: Promise<string>;
  refs: number;
  url: string | null;
  evicted: boolean;
}

/** Pictures nobody shows any more that are kept for the next theme switch. */
const IDLE_PICTURES = 6;
const entries = new Map<string, Entry>();
/** One picture draws at a time, so a theme editor's live preview never holds several GPU contexts. */
let queue: Promise<unknown> = Promise.resolve();

function evict(key: string, entry: Entry) {
  entries.delete(key);
  entry.evicted = true;
  if (entry.url) URL.revokeObjectURL(entry.url);
}

function trimIdle() {
  const idle = [...entries].filter(([, entry]) => entry.refs === 0);
  for (const [key, entry] of idle.slice(0, Math.max(0, idle.length - IDLE_PICTURES))) {
    evict(key, entry);
  }
}

export interface RestRingHold {
  /** The picture's object URL once drawn. Rejects when WebGL cannot draw it. */
  readonly picture: Promise<string>;
  /** Lets the picture go; it is revoked once enough idle ones have piled up. */
  readonly release: () => void;
}

/**
 * Holds the rest-pose ring in these colors (any CSS color syntax: shadow, mid, light), drawing
 * it if no one has. A held picture is never revoked; released ones are kept up to a small
 * number, oldest dropped first.
 */
export function holdRestRing(input: {
  readonly lo: string;
  readonly mid: string;
  readonly hi: string;
  readonly dark: boolean;
  readonly size: OrbMarkSize;
  readonly density: number;
}): RestRingHold {
  const key = JSON.stringify(input);
  let entry = entries.get(key);
  if (!entry) {
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
    const drawn = queue.then(
      () => renderRestRing(job),
      () => renderRestRing(job),
    );
    queue = drawn;
    const created: Entry = {
      refs: 0,
      url: null,
      evicted: false,
      picture: drawn.then((blob) => {
        const url = URL.createObjectURL(blob);
        if (created.evicted) URL.revokeObjectURL(url);
        else created.url = url;
        return url;
      }),
    };
    created.picture.catch(() => {
      if (entries.get(key) === created) entries.delete(key);
    });
    entries.set(key, created);
    entry = created;
  }
  const held = entry;
  held.refs += 1;
  // Most recently used last, so the idle ones trim oldest first.
  entries.delete(key);
  entries.set(key, held);
  let released = false;
  return {
    picture: held.picture,
    release: () => {
      if (released) return;
      released = true;
      held.refs -= 1;
      trimIdle();
    },
  };
}
