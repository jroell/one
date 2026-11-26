import { observeResize } from "~/lib/observeResize";
import { ORB_OPEN_ANGLE, ORB_REST, ORB_SUPERSAMPLE, glowForSize } from "./oneOrbRest";
import { ONE_ORB_FRAGMENT_SHADER, ONE_ORB_VERTEX_SHADER } from "./oneOrbShader";

/**
 * "waiting" is a rigid ring held edge-on with one sweep of light crossing it: the same waiting
 * the voice stage shows while thinking, without the turning.
 */
export type OneOrbState = "idle" | "listening" | "thinking" | "waiting" | "speaking";

type OrbPose = Readonly<{
  tilt: number;
  /** Continuous turning, in radians per second. Zero means the ring holds `spinOffset` from its open angle. */
  spinSpeed: number;
  /** Where a ring that is not turning holds, in radians from its open angle. Half a pi is edge-on. */
  spinOffset: number;
  /** How far the resting ring rocks from side to side, in radians. */
  sway: number;
  pulse: number;
  baseEnergy: number;
  /** Strength of the smoke-like corona and drifting sparks, 0 to 1. */
  aura: number;
  /** The waiting sweep of light round the band, 0 to 1. */
  sweep: number;
}>;

const POSES: Record<OneOrbState, OrbPose> = {
  // 0.78 foreshortens the band to the mark's own silhouette: a silhouette 0.7 as tall as wide, leaning 29 degrees.
  idle: {
    tilt: ORB_REST.tilt,
    spinSpeed: 0,
    spinOffset: 0,
    sway: 0,
    pulse: 0,
    baseEnergy: 0,
    aura: ORB_REST.aura,
    sweep: 0,
  },
  listening: {
    tilt: 1.46,
    spinSpeed: 0,
    spinOffset: 0,
    sway: 0.12,
    pulse: 0,
    baseEnergy: 0.12,
    aura: 0.5,
    sweep: 0,
  },
  thinking: {
    tilt: 1.12,
    spinSpeed: 1.9,
    spinOffset: 0,
    sway: 0,
    pulse: 1,
    baseEnergy: 0.06,
    aura: 0.75,
    sweep: 0,
  },
  waiting: {
    tilt: 1.12,
    spinSpeed: 0,
    spinOffset: Math.PI / 2,
    sway: 0,
    pulse: 1,
    baseEnergy: 0.06,
    aura: 0.75,
    sweep: 1,
  },
  speaking: {
    tilt: 1.26,
    spinSpeed: 0,
    spinOffset: 0,
    sway: 0.24,
    pulse: 0,
    baseEnergy: 0.1,
    aura: 0.55,
    sweep: 0,
  },
};

/** Seconds the catch-light takes to go once around the band. */
const ORBIT_SECONDS = 12;
/** The sheet duration: the move into and out of the waiting pose finishes inside it. */
export const WAITING_MOVE_MS = 320;
/** Easing rate that leaves under 2% of a move after `WAITING_MOVE_MS`. */
const SNAPPY_RATE = 14;
const MAX_PIXEL_RATIO = 2 * ORB_SUPERSAMPLE;
const LARGE_RING_PX = 300;
/**
 * Backing-store scale ceilings for a large ring, best first. A ring starts at the first and
 * moves down one step each time it falls behind (see `trackFrameTime`); it never moves back up.
 */
export const LARGE_RING_PIXEL_RATIOS = [1.5, 1.25, 1] as const;

/**
 * Wait between frames while the ring sits at rest. Its catch-light takes twelve seconds to go
 * round, so twenty frames a second show it moving smoothly for a third of the shading cost. A
 * resting ring keeps this pace while it can be seen, and draws nothing while it cannot.
 */
export const RESTING_FRAME_MS = 50;
/**
 * Without input for this long, a resting ring finishes the turn of its catch-light, stops at the
 * place the still picture has it, and draws nothing more until the pointer, keyboard or focus
 * return. An idle app must not keep the GPU busy.
 */
export const IDLE_PARK_MS = 30_000;
/** Longest step of the animation clock. A frame that arrives late must not make the ring jump. */
const MAX_FRAME_SECONDS = 0.05;
/** The same limit for a resting frame, which arrives `RESTING_FRAME_MS` after the last one. */
const MAX_RESTING_FRAME_SECONDS = 0.25;

/** A frame slower than this is below about 40 frames a second. */
export const SLOW_FRAME_MS = 24;
/** Consecutive slow frames before the ring renders at the next lower scale. */
export const SLOW_FRAMES_BEFORE_STEP_DOWN = 10;
/** A gap this long is a pause (hidden tab, scrolled away), not a slow frame. */
const PAUSE_FRAME_MS = 250;

/** How close a pose value must be to its target before the ring counts as settled. */
const SETTLED_ANGLE = 0.005;
const SETTLED_LEVEL = 0.02;

/** The values the ring eases toward a pose. `spin` is the turn angle without the sway. */
export type OrbMotion = Readonly<{
  spin: number;
  sway: number;
  tilt: number;
  pulse: number;
  energy: number;
  aura: number;
  reveal: number;
}>;

/**
 * Where the ring's axis points for a spin and a tilt, as the shader builds them (spin about the
 * vertical, then tilt toward the viewer). The ring looks the same turned over, so only this
 * direction matters to its silhouette.
 */
export function ringAxis(spin: number, tilt: number): readonly [number, number, number] {
  return [-Math.sin(spin) * Math.sin(tilt), Math.cos(tilt), Math.cos(spin) * Math.sin(tilt)];
}

/**
 * What the eye reads of an axis: how open the ring is (`open`, 0 edge-on to 1 face-on) and which
 * way its long side leans on screen (`lean`, a line, so modulo a half turn).
 */
export function ringLook(axis: readonly [number, number, number]): {
  readonly open: number;
  readonly lean: number;
} {
  const lean = Math.atan2(axis[1], axis[0]);
  return { open: Math.abs(axis[2]), lean: ((lean % Math.PI) + Math.PI) % Math.PI };
}

/** An axis with the look `open` and `lean`, on the viewer's side. */
function axisFor(open: number, lean: number): readonly [number, number, number] {
  const across = Math.sqrt(Math.max(0, 1 - open * open));
  return [across * Math.cos(lean), across * Math.sin(lean), open];
}

/** Spin and tilt for an axis, with the spin carried to the turn nearest `near`. */
function spinAndTiltFor(
  axis: readonly [number, number, number],
  near: number,
): { readonly spin: number; readonly tilt: number } {
  const tilt = Math.acos(Math.min(1, Math.max(-1, axis[1])));
  const raw = Math.atan2(-axis[0], axis[2]);
  return { spin: raw + 2 * Math.PI * Math.round((near - raw) / (2 * Math.PI)), tilt };
}

/** The nearest angle where the ring holds `offset` from open; the band looks the same every half turn. */
function restAngle(spin: number, offset = 0): number {
  const origin = ORB_OPEN_ANGLE + offset;
  return origin + Math.PI * Math.round((spin - origin) / Math.PI);
}

/**
 * Where the glow settles for a pose: its base and the live sound level. An idle ring does not
 * breathe, so at rest it is the same picture as the static mark (public/mark).
 */
function energyTarget(state: OneOrbState, _time: number, level: number): number {
  return Math.min(1, POSES[state].baseEnergy + Math.min(1, Math.max(0, level)));
}

/** True when nothing is still easing toward the pose, so only the slow smoke and sway move. */
function isOrbSettled(motion: OrbMotion, state: OneOrbState, time: number, level: number): boolean {
  const pose = POSES[state];
  return (
    motion.reveal >= 1 &&
    level <= 0 &&
    pose.spinSpeed === 0 &&
    Math.abs(restAngle(motion.spin, pose.spinOffset) - motion.spin) < SETTLED_ANGLE &&
    Math.abs(motion.sway - pose.sway) < SETTLED_ANGLE &&
    Math.abs(motion.tilt - pose.tilt) < SETTLED_ANGLE &&
    Math.abs(motion.pulse - pose.pulse) < SETTLED_LEVEL &&
    Math.abs(motion.aura - pose.aura) < SETTLED_LEVEL &&
    Math.abs(motion.energy - energyTarget(state, time, level)) < SETTLED_LEVEL
  );
}

/** Milliseconds to wait before the next frame: zero for full speed, longer for a settled idle ring. */
export function frameIntervalMs(
  motion: OrbMotion,
  state: OneOrbState,
  time: number,
  level: number,
  glowActive = false,
): number {
  return state === "idle" && !glowActive && isOrbSettled(motion, state, time, level)
    ? RESTING_FRAME_MS
    : 0;
}

/** What the next frame does. */
export type FramePlan = Readonly<{
  /** Milliseconds to wait before the frame: zero for full speed. */
  intervalMs: number;
  /** The ring is idle and settled, so it draws at the resting cadence. */
  resting: boolean;
}>;

/** Decides the cadence from the ring's motion. */
export function restingPlan(
  motion: OrbMotion,
  state: OneOrbState,
  time: number,
  level: number,
  glowActive = false,
): FramePlan {
  const intervalMs = frameIntervalMs(motion, state, time, level, glowActive);
  return { intervalMs, resting: intervalMs > 0 };
}

/** The plan for reduced motion: one frame per `wake()` at the normal scale, and no loop to stop. */
const STILL_PLAN: FramePlan = { intervalMs: 0, resting: false };

/** How a frame loop is doing against the frame budget. */
export type FrameBudget = Readonly<{
  /** Index into `LARGE_RING_PIXEL_RATIOS`. */
  step: number;
  /** Slow frames in a row. */
  slowFrames: number;
}>;

export const FRAME_BUDGET_START: FrameBudget = { step: 0, slowFrames: 0 };

/** Folds in the time one full-speed frame took. After enough slow ones in a row the scale steps down. */
export function trackFrameTime(budget: FrameBudget, frameMs: number): FrameBudget {
  if (frameMs <= SLOW_FRAME_MS || frameMs >= PAUSE_FRAME_MS) {
    return budget.slowFrames === 0 ? budget : { ...budget, slowFrames: 0 };
  }
  const slowFrames = budget.slowFrames + 1;
  if (slowFrames < SLOW_FRAMES_BEFORE_STEP_DOWN) return { ...budget, slowFrames };
  return { step: Math.min(budget.step + 1, LARGE_RING_PIXEL_RATIOS.length - 1), slowFrames: 0 };
}

/** The highest backing-store scale for a ring. A large ring has pixels to spare, so it uses less. */
export function pixelRatioCap(clientWidth: number, step: number): number {
  if (clientWidth <= LARGE_RING_PX) return MAX_PIXEL_RATIO;
  return LARGE_RING_PIXEL_RATIOS[Math.min(step, LARGE_RING_PIXEL_RATIOS.length - 1)] ?? 1;
}

/** Whether a frame may draw. Anything that cannot be seen, or has no GPU context, draws nothing. */
export function canDrawFrame(view: {
  /** Null until the intersection observer reports for the first time. */
  readonly visible: boolean | null;
  readonly documentHidden: boolean;
  readonly width: number;
  readonly height: number;
  readonly contextAvailable: boolean;
}): boolean {
  return (
    view.contextAvailable &&
    view.visible === true &&
    !view.documentHidden &&
    view.width > 0 &&
    view.height > 0
  );
}

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

const UNIFORM_NAMES = {
  res: "uRes",
  time: "uTime",
  hi: "uHi",
  mid: "uMid",
  lo: "uLo",
  energy: "uEnergy",
  spin: "uSpin",
  tilt: "uTilt",
  pulse: "uPulse",
  level: "uLevel",
  sweep: "uSweep",
  dark: "uDark",
  aura: "uAura",
  reveal: "uReveal",
  glow: "uGlow",
  orbit: "uOrbit",
} as const;

/** Everything the GPU holds for the ring. A lost context takes all of it. */
type GlResources = Readonly<{
  program: WebGLProgram;
  vertex: WebGLShader;
  fragment: WebGLShader;
  buffer: WebGLBuffer;
  uniforms: Readonly<Record<keyof typeof UNIFORM_NAMES, WebGLUniformLocation | null>>;
}>;

/** Compiles the ring and loads its triangle. Returns null on a compile or link failure. */
function createResources(gl: WebGLRenderingContext): GlResources | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, ONE_ORB_VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, ONE_ORB_FRAGMENT_SHADER);
  const program = vertex && fragment ? gl.createProgram() : null;
  const fail = () => {
    if (program) gl.deleteProgram(program);
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  };
  if (!vertex || !fragment || !program) return fail();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return fail();
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  if (!buffer) return fail();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const uniforms = Object.fromEntries(
    Object.entries(UNIFORM_NAMES).map(([key, name]) => [key, gl.getUniformLocation(program, name)]),
  ) as GlResources["uniforms"];
  return { program, vertex, fragment, buffer, uniforms };
}

function releaseResources(gl: WebGLRenderingContext, resources: GlResources) {
  gl.deleteProgram(resources.program);
  gl.deleteShader(resources.vertex);
  gl.deleteShader(resources.fragment);
  gl.deleteBuffer(resources.buffer);
}

/**
 * Draws the ring on a canvas until disposed, only while it can be seen and slowly while it rests.
 * Returns null (after onUnsupported) without WebGL. A lost context keeps the canvas and
 * rebuilds the ring on restore.
 */
export function startOneOrb(
  canvas: HTMLCanvasElement,
  input: {
    readonly getState: () => OneOrbState;
    /** Live sound level, 0 to 1, read every frame. It swells the whole ring (ripple and band). */
    readonly getLevel: () => number;
    /**
     * Rim and halo level, 0 to 1, read every frame. It lights the ring without changing its
     * shape: the silhouette is the same at every level.
     */
    readonly getGlowLevel?: () => number;
    /** WebGL is missing, or the shaders would not compile or link. The canvas will not draw. */
    readonly onUnsupported: () => void;
    /** The GPU context was lost. Show a stand-in until `onContextRestored`; the canvas stays mounted. */
    readonly onContextLost?: () => void;
    readonly onContextRestored?: () => void;
    /** Plays the opening once: the ring ignites out of the dark over this many seconds. */
    readonly openingSeconds?: number;
  },
): OneOrbRenderer | null {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, antialias: false });
  if (!gl) {
    input.onUnsupported();
    return null;
  }
  // A canvas whose context was lost before this started (the effect restarted mid-loss) waits for the restore.
  let contextLost = gl.isContextLost();
  let resources = contextLost ? null : createResources(gl);
  if (!resources && !contextLost) {
    input.onUnsupported();
    return null;
  }

  const readColor = createColorReader();
  const applyColors = () => {
    if (!resources) return;
    const style = getComputedStyle(canvas);
    gl.uniform3fv(resources.uniforms.hi, readColor(style.getPropertyValue("--one-ring-hi")));
    gl.uniform3fv(resources.uniforms.mid, readColor(style.getPropertyValue("--one-ring-mid")));
    gl.uniform3fv(resources.uniforms.lo, readColor(style.getPropertyValue("--one-ring-lo")));
    gl.uniform1f(
      resources.uniforms.dark,
      document.documentElement.classList.contains("dark") ? 1 : 0,
    );
  };

  let budget = FRAME_BUDGET_START;
  const resize = () => {
    if (!resources) return;
    // A resting ring keeps its full resolution: it is what people look at.
    const cap = pixelRatioCap(canvas.clientWidth, budget.step);
    const density = window.devicePixelRatio || 1;
    const ratio = Math.min(
      canvas.clientWidth <= LARGE_RING_PX ? density * ORB_SUPERSAMPLE : density,
      cap,
    );
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.uniform2f(resources.uniforms.res, width, height);
    gl.uniform1f(resources.uniforms.glow, glowForSize(canvas.clientWidth));
  };
  applyColors();
  resize();

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Null until the intersection observer has answered: a ring in a hidden element must not draw first. */
  let visible: boolean | null = null;
  let last = performance.now();
  let time = 0;
  let spin = ORB_OPEN_ANGLE;
  let sway = POSES[input.getState()].sway;
  let tilt = POSES[input.getState()].tilt;
  let pulse = 0;
  let energy = 0;
  let glowLevel = 0;
  let sweep = 0;
  /** Until when poses ease fast: into the waiting pose and back out of it take the sheet duration. */
  let snappyUntil = 0;
  const openingSeconds = input.openingSeconds ?? 0;
  let reveal = openingSeconds > 0 ? 0 : 1;
  const openingStarted = performance.now();
  let aura = openingSeconds > 0 ? 1 : POSES[input.getState()].aura;
  const motion = (): OrbMotion => ({ spin, sway, tilt, pulse, energy, aura, reveal });

  let lastActivity = performance.now();
  let lastDrawn = Number.NEGATIVE_INFINITY;
  /** When the previous full-speed frame started, or null when the loop was not running at full speed. */
  let lastFullSpeedFrame: number | null = null;

  const cancelScheduled = () => {
    if (frame !== 0) cancelAnimationFrame(frame);
    frame = 0;
    clearTimeout(timer);
    timer = undefined;
    lastFullSpeedFrame = null;
  };
  /** Asks for the next frame after `delayMs`; a frame or timer already pending is kept. */
  const schedule = (delayMs = 0) => {
    if (frame !== 0 || timer !== undefined) return;
    if (visible !== true || document.hidden || !resources) return;
    if (delayMs > 0) {
      timer = setTimeout(() => {
        timer = undefined;
        schedule();
      }, delayMs);
    } else {
      frame = requestAnimationFrame(draw);
    }
  };
  const draw = (now: number) => {
    frame = 0;
    // The state can change after the frame was queued: check again that anything can be seen.
    if (
      !resources ||
      !canDrawFrame({
        visible,
        documentHidden: document.hidden,
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        contextAvailable: !contextLost,
      })
    ) {
      lastFullSpeedFrame = null;
      return;
    }
    const state = input.getState();
    const previousTurns = time / ORBIT_SECONDS;
    const level = Math.min(1, Math.max(0, input.getLevel()));
    const glowTarget = Math.min(1, Math.max(0, input.getGlowLevel?.() ?? 0));
    const still = reducedMotion.matches;
    const plan = still
      ? STILL_PLAN
      : restingPlan(motion(), state, time, level, glowTarget > 0 || glowLevel > SETTLED_LEVEL);
    const interval = plan.intervalMs;
    const wait = interval - (now - lastDrawn);
    if (interval > 0 && wait > 0) {
      lastFullSpeedFrame = null;
      schedule(wait);
      return;
    }
    if (interval === 0 && !still) {
      // Frame to frame time, not the time spent in the draw call: GL commands return at once and
      // the browser slows the frames when the GPU falls behind.
      if (lastFullSpeedFrame !== null) {
        const next = trackFrameTime(budget, now - lastFullSpeedFrame);
        const steppedDown = next.step !== budget.step;
        budget = next;
        if (steppedDown) resize();
      }
      lastFullSpeedFrame = now;
    } else {
      lastFullSpeedFrame = null;
    }
    lastDrawn = now;
    const delta = Math.min(
      interval > 0 ? MAX_RESTING_FRAME_SECONDS : MAX_FRAME_SECONDS,
      (now - last) / 1000,
    );
    last = now;
    const pose = POSES[state];
    if (still) {
      tilt = pose.tilt;
      pulse = 0;
      sweep = 0;
      spin = ORB_OPEN_ANGLE + pose.spinOffset;
      glowLevel = glowTarget;
      energy = pose.baseEnergy;
      reveal = 1;
      aura = pose.aura;
    } else {
      if (state === "waiting") snappyUntil = now + WAITING_MOVE_MS * 2;
      const snappy = now < snappyUntil;
      const ease = 1 - Math.exp(-delta * (snappy ? SNAPPY_RATE : 5.5));
      time += delta;
      // Leaving the waiting pose is one turn of what the eye sees: the ring opens or closes toward
      // its resting look while its lean turns the short way, so it never passes through edge-on
      // and back, however its spin and tilt differ.
      const leavingWaiting = snappy && state !== "waiting" && pose.spinSpeed === 0;
      let axisMoved = false;
      if (leavingWaiting) {
        const holdSpin = restAngle(spin, pose.spinOffset);
        const target = ringLook(ringAxis(holdSpin, pose.tilt));
        const here = ringLook(ringAxis(spin, tilt));
        const turn =
          ((((target.lean - here.lean) % Math.PI) + 1.5 * Math.PI) % Math.PI) - Math.PI / 2;
        const open = here.open + (target.open - here.open) * ease;
        const lean = here.lean + turn * ease;
        // Of the turned-over forms that look alike, the one nearest the resting pose.
        const goal = ringAxis(holdSpin, pose.tilt);
        const candidates = [axisFor(open, lean), axisFor(open, lean + Math.PI)].map(
          (candidate) =>
            [
              candidate,
              candidate[0] * goal[0] + candidate[1] * goal[1] + candidate[2] * goal[2],
            ] as const,
        );
        const best = candidates[0]![1] >= candidates[1]![1] ? candidates[0]![0] : candidates[1]![0];
        const next = spinAndTiltFor(best, holdSpin);
        spin = next.spin;
        tilt = next.tilt;
        axisMoved = true;
      }
      if (pose.spinSpeed > 0) {
        spin += delta * pose.spinSpeed;
      } else if (!axisMoved) {
        // The nearest hold, so the move takes the short way round.
        spin +=
          (restAngle(spin, pose.spinOffset) - spin) *
          (1 - Math.exp(-delta * (snappy ? SNAPPY_RATE : 3)));
      }
      // The opening runs on the wall clock, so a slow first frame cannot leave the ring half lit
      // when the cover lifts.
      if (reveal < 1) reveal = Math.min(1, (now - openingStarted) / (openingSeconds * 1000));
      // The corona burns high through the opening, then settles to the resting glow.
      const auraTarget = reveal < 1 ? 1 : pose.aura;
      aura += (auraTarget - aura) * (1 - Math.exp(-delta * 1.2));
      sway += (pose.sway - sway) * ease;
      if (!axisMoved) tilt += (pose.tilt - tilt) * ease;
      pulse += (pose.pulse - pulse) * ease;
      sweep += (pose.sweep - sweep) * ease;
      const target = energyTarget(state, time, level);
      // Rise fast, fall slowly, so speech reads as a swell rather than a flicker.
      energy += (target - energy) * (1 - Math.exp(-delta * (target > energy ? 18 : 5)));
      glowLevel +=
        (glowTarget - glowLevel) * (1 - Math.exp(-delta * (glowTarget > glowLevel ? 18 : 5)));
    }
    const { uniforms } = resources;
    gl.uniform1f(uniforms.time, time);
    gl.uniform1f(uniforms.spin, spin + sway * Math.sin(time * 0.55));
    gl.uniform1f(uniforms.tilt, tilt);
    gl.uniform1f(uniforms.pulse, pulse);
    gl.uniform1f(uniforms.energy, energy);
    gl.uniform1f(uniforms.level, glowLevel);
    gl.uniform1f(uniforms.sweep, sweep);
    gl.uniform1f(uniforms.aura, aura);
    gl.uniform1f(uniforms.reveal, reveal);
    // Parks on the turn that brings the catch-light to the still picture's place, so the stop is
    // not a jump.
    const turns = time / ORBIT_SECONDS;
    const park =
      !still &&
      plan.resting &&
      now - lastActivity > IDLE_PARK_MS &&
      Math.floor(turns - ORB_REST.orbit) > Math.floor(previousTurns - ORB_REST.orbit);
    gl.uniform1f(uniforms.orbit, still || park ? ORB_REST.orbit : turns % 1);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (still || park) return;
    const next = restingPlan(
      motion(),
      input.getState(),
      time,
      level,
      glowTarget > 0 || glowLevel > SETTLED_LEVEL,
    );
    // A resting ring in a window nobody is looking at keeps the frame it has; focus brings it back.
    if (next.resting && !document.hasFocus()) return;
    schedule(next.intervalMs);
  };
  const wake = () => {
    last = performance.now();
    lastDrawn = Number.NEGATIVE_INFINITY;
    lastFullSpeedFrame = null;
    clearTimeout(timer);
    timer = undefined;
    schedule();
  };
  // Input and focus end a pause or a park. Only a ring that stopped has anything to wake.
  const onActivity = () => {
    lastActivity = performance.now();
    if (frame === 0 && timer === undefined) wake();
  };
  const activityEvents = ["pointermove", "pointerdown", "keydown", "wheel", "focus"] as const;
  for (const name of activityEvents) {
    window.addEventListener(name, onActivity, { passive: true, capture: true });
  }
  /** Draws when the ring can be seen again, and stops the queued frame when it cannot. */
  const syncWithVisibility = () => {
    if (visible === true && !document.hidden) wake();
    else cancelScheduled();
  };

  const visibility = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
    syncWithVisibility();
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
  // Moving the window to a screen with another pixel density changes the buffer size, not the CSS
  // size. A query for the current density only fires once, so it is armed again after each change.
  let densityQuery: MediaQueryList | null = null;
  const onDensityChange = () => {
    resize();
    wake();
    watchDensity();
  };
  const watchDensity = () => {
    densityQuery?.removeEventListener("change", onDensityChange);
    densityQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    densityQuery.addEventListener("change", onDensityChange);
  };
  watchDensity();
  document.addEventListener("visibilitychange", syncWithVisibility);
  reducedMotion.addEventListener("change", wake);

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelScheduled();
    visibility.disconnect();
    stopObservingSize();
    themeObserver.disconnect();
    densityQuery?.removeEventListener("change", onDensityChange);
    document.removeEventListener("visibilitychange", syncWithVisibility);
    for (const name of activityEvents) window.removeEventListener(name, onActivity, true);
    reducedMotion.removeEventListener("change", wake);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    canvas.removeEventListener("webglcontextrestored", onContextRestored);
    if (resources) releaseResources(gl, resources);
    resources = null;
  };
  const onContextLost = (event: Event) => {
    // Without this the browser never restores the context.
    event.preventDefault();
    contextLost = true;
    cancelScheduled();
    // The GPU objects went with the context; deleting them now would do nothing.
    resources = null;
    // A canvas that left the page cannot be shown again, so nothing is left to restore.
    if (!canvas.isConnected) {
      dispose();
      return;
    }
    input.onContextLost?.();
  };
  const onContextRestored = () => {
    const rebuilt = createResources(gl);
    if (!rebuilt) {
      input.onUnsupported();
      return;
    }
    resources = rebuilt;
    contextLost = false;
    applyColors();
    resize();
    input.onContextRestored?.();
    wake();
  };
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);
  if (contextLost) input.onContextLost?.();
  return { wake, dispose };
}
