import { observeResize } from "~/lib/observeResize";
import { ONE_ORB_FRAGMENT_SHADER, ONE_ORB_VERTEX_SHADER } from "./oneOrbShader";

export type OneOrbState = "idle" | "listening" | "thinking" | "speaking";

type OrbPose = Readonly<{
  tilt: number;
  /** Continuous turning, in radians per second. Zero means the ring rests at its open angle. */
  spinSpeed: number;
  /** How far the resting ring rocks from side to side, in radians. */
  sway: number;
  pulse: number;
  baseEnergy: number;
  /** Strength of the smoke-like corona and drifting sparks, 0 to 1. */
  aura: number;
}>;

const POSES: Record<OneOrbState, OrbPose> = {
  idle: { tilt: 1.02, spinSpeed: 0, sway: 0.42, pulse: 0, baseEnergy: 0, aura: 0.3 },
  listening: { tilt: 1.46, spinSpeed: 0, sway: 0.12, pulse: 0, baseEnergy: 0.12, aura: 0.5 },
  thinking: { tilt: 1.12, spinSpeed: 1.9, sway: 0, pulse: 1, baseEnergy: 0.06, aura: 0.75 },
  speaking: { tilt: 1.26, spinSpeed: 0, sway: 0.24, pulse: 0, baseEnergy: 0.1, aura: 0.55 },
};

/** The resting angle that shows the opening of the ring. The band looks the same every half turn. */
const OPEN_ANGLE = 0.48;

const MAX_PIXEL_RATIO = 2;
/** About 30 frames a second while the ring is at rest. */
const RESTING_FRAME_MS = 30;

/** Resolves any CSS color (including oklch and color-mix) to linear-ish RGB through a 1px canvas. */
function createColorReader(): (color: string) => [number, number, number] {
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const context = probe.getContext("2d", { willReadFrequently: true });
  return (color) => {
    if (!context) return [1, 0.75, 0.3];
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "#000";
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
    return [(r / 255) ** 2.2, (g / 255) ** 2.2, (b / 255) ** 2.2];
  };
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export type OneOrbRenderer = Readonly<{
  /** Draws again after something the renderer cannot see changed, such as the state. */
  wake: () => void;
  dispose: () => void;
}>;

/**
 * Draws the ring on a canvas until disposed. It renders only while the canvas
 * is on screen and the tab is visible, and draws single frames under reduced
 * motion. Returns null (after calling onUnsupported) when WebGL is unavailable.
 */
export function startOneOrb(
  canvas: HTMLCanvasElement,
  input: {
    readonly getState: () => OneOrbState;
    /** Live sound level, 0 to 1, read every frame. */
    readonly getLevel: () => number;
    readonly onUnsupported: () => void;
    /** Plays the opening once: the ring ignites out of the dark over this many seconds. */
    readonly openingSeconds?: number;
  },
): OneOrbRenderer | null {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, antialias: false });
  if (!gl) {
    input.onUnsupported();
    return null;
  }
  const vertex = compile(gl, gl.VERTEX_SHADER, ONE_ORB_VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, ONE_ORB_FRAGMENT_SHADER);
  const program = vertex && fragment ? gl.createProgram() : null;
  const release = () => {
    if (program) gl.deleteProgram(program);
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
  };
  if (!vertex || !fragment || !program) {
    release();
    input.onUnsupported();
    return null;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    release();
    input.onUnsupported();
    return null;
  }
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const uniforms = {
    res: uniform("uRes"),
    time: uniform("uTime"),
    hi: uniform("uHi"),
    mid: uniform("uMid"),
    lo: uniform("uLo"),
    energy: uniform("uEnergy"),
    spin: uniform("uSpin"),
    tilt: uniform("uTilt"),
    pulse: uniform("uPulse"),
    dark: uniform("uDark"),
    aura: uniform("uAura"),
    reveal: uniform("uReveal"),
  };

  const readColor = createColorReader();
  const applyColors = () => {
    const style = getComputedStyle(canvas);
    gl.uniform3fv(uniforms.hi, readColor(style.getPropertyValue("--one-ring-hi")));
    gl.uniform3fv(uniforms.mid, readColor(style.getPropertyValue("--one-ring-mid")));
    gl.uniform3fv(uniforms.lo, readColor(style.getPropertyValue("--one-ring-lo")));
    gl.uniform1f(uniforms.dark, document.documentElement.classList.contains("dark") ? 1 : 0);
  };
  applyColors();

  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.uniform2f(uniforms.res, width, height);
  };
  resize();

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let visible = true;
  let last = performance.now();
  let time = 0;
  let spin = OPEN_ANGLE;
  let sway = POSES[input.getState()].sway;
  let tilt = POSES[input.getState()].tilt;
  let pulse = 0;
  let energy = 0;
  const openingSeconds = input.openingSeconds ?? 0;
  let reveal = openingSeconds > 0 ? 0 : 1;
  let aura = openingSeconds > 0 ? 1 : POSES[input.getState()].aura;

  let lastDrawn = 0;
  const draw = (now: number) => {
    frame = 0;
    // A ring at rest moves slowly, so half the frames show the same motion at half the cost.
    const resting = input.getState() === "idle" && reveal >= 1;
    if (resting && now - lastDrawn < RESTING_FRAME_MS) {
      schedule();
      return;
    }
    lastDrawn = now;
    const delta = Math.min(0.05, (now - last) / 1000);
    last = now;
    const pose = POSES[input.getState()];
    const still = reducedMotion.matches;
    if (still) {
      tilt = pose.tilt;
      pulse = 0;
      energy = pose.baseEnergy;
      reveal = 1;
      aura = pose.aura;
    } else {
      const ease = 1 - Math.exp(-delta * 5.5);
      time += delta;
      if (pose.spinSpeed > 0) {
        spin += delta * pose.spinSpeed;
      } else {
        const rest = OPEN_ANGLE + Math.PI * Math.round((spin - OPEN_ANGLE) / Math.PI);
        spin += (rest - spin) * (1 - Math.exp(-delta * 3));
      }
      if (reveal < 1) reveal = Math.min(1, reveal + delta / openingSeconds);
      // The corona burns high through the opening, then settles to the resting glow.
      const auraTarget = reveal < 1 ? 1 : pose.aura;
      aura += (auraTarget - aura) * (1 - Math.exp(-delta * 1.2));
      sway += (pose.sway - sway) * ease;
      tilt += (pose.tilt - tilt) * ease;
      pulse += (pose.pulse - pulse) * ease;
      const breathing = input.getState() === "idle" ? 0.035 * (1 + Math.sin(time * 1.3)) : 0;
      const level = Math.min(1, Math.max(0, input.getLevel()));
      const target = Math.min(1, pose.baseEnergy + breathing + level);
      // Rise fast, fall slowly, so speech reads as a swell rather than a flicker.
      energy += (target - energy) * (1 - Math.exp(-delta * (target > energy ? 18 : 5)));
    }
    gl.uniform1f(uniforms.time, time);
    gl.uniform1f(uniforms.spin, spin + sway * Math.sin(time * 0.55));
    gl.uniform1f(uniforms.tilt, tilt);
    gl.uniform1f(uniforms.pulse, pulse);
    gl.uniform1f(uniforms.energy, energy);
    gl.uniform1f(uniforms.aura, aura);
    gl.uniform1f(uniforms.reveal, reveal);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!still) schedule();
  };
  const schedule = () => {
    if (frame === 0 && visible && !document.hidden) {
      frame = requestAnimationFrame(draw);
    }
  };
  const wake = () => {
    last = performance.now();
    schedule();
  };

  const visibility = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
    wake();
  });
  visibility.observe(canvas);
  const stopObservingSize = observeResize(canvas, () => {
    resize();
    wake();
  });
  const themeObserver = new MutationObserver(() => {
    applyColors();
    wake();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style", "data-theme-id"],
  });
  const onWake = () => wake();
  // Moving the window to a screen with another pixel density changes the buffer size, not the CSS size.
  const onDensityChange = () => {
    resize();
    wake();
  };
  window.addEventListener("resize", onDensityChange);
  document.addEventListener("visibilitychange", onWake);
  reducedMotion.addEventListener("change", onWake);
  const onContextLost = (event: Event) => {
    event.preventDefault();
    input.onUnsupported();
  };
  canvas.addEventListener("webglcontextlost", onContextLost);
  schedule();

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("resize", onDensityChange);
    if (frame !== 0) cancelAnimationFrame(frame);
    visibility.disconnect();
    stopObservingSize();
    themeObserver.disconnect();
    document.removeEventListener("visibilitychange", onWake);
    reducedMotion.removeEventListener("change", onWake);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    release();
    gl.deleteBuffer(buffer);
  };
  return { wake, dispose };
}
