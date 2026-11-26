import { describe, expect, it } from "vite-plus/test";

import {
  ATTENTION_MS,
  canDrawFrame,
  frameIntervalMs,
  FRAME_BUDGET_START,
  LARGE_RING_PIXEL_RATIOS,
  pixelRatioCap,
  restingPlan,
  RESTING_FRAME_MS,
  SLOW_FRAME_MS,
  SLOW_FRAMES_BEFORE_STEP_DOWN,
  trackFrameTime,
  type FrameBudget,
  type OrbMotion,
  type OneOrbState,
} from "./oneOrbRenderer";
import { glowForSize } from "./oneOrbRest";

/** The ring after it has eased into the idle pose: open angle, idle tilt, no sway and no breathing. */
const IDLE_AT_REST: OrbMotion = {
  spin: 0.48,
  sway: 0,
  tilt: 0.72,
  pulse: 0,
  energy: 0,
  aura: 0.3,
  reveal: 1,
};

describe("how long the ring waits between frames", () => {
  it("waits RESTING_FRAME_MS when the ring is idle and settled", () => {
    expect(frameIntervalMs(IDLE_AT_REST, "idle", 0, 0)).toBe(RESTING_FRAME_MS);
  });

  it.each<{ name: string; state: OneOrbState; motion: Partial<OrbMotion>; level: number }>([
    { name: "sound is playing", state: "idle", motion: {}, level: 0.2 },
    {
      name: "the opening is still lighting the ring",
      state: "idle",
      motion: { reveal: 0.6 },
      level: 0,
    },
    { name: "the tilt is still easing", state: "idle", motion: { tilt: 1.3 }, level: 0 },
    { name: "the ring is mid turn", state: "idle", motion: { spin: 1.6 }, level: 0 },
    { name: "the sway is still easing", state: "idle", motion: { sway: 0.1 }, level: 0 },
    { name: "the pulse has not faded", state: "idle", motion: { pulse: 0.5 }, level: 0 },
    { name: "the glow is still rising", state: "idle", motion: { energy: 0.3 }, level: 0 },
    { name: "the corona is still settling", state: "idle", motion: { aura: 0.8 }, level: 0 },
    {
      name: "the ring is listening",
      state: "listening",
      motion: { tilt: 1.46, sway: 0.12, aura: 0.5, energy: 0.12 },
      level: 0,
    },
    {
      name: "the ring is thinking",
      state: "thinking",
      motion: { tilt: 1.12, sway: 0, pulse: 1, aura: 0.75, energy: 0.06 },
      level: 0,
    },
    {
      name: "the ring is speaking",
      state: "speaking",
      motion: { tilt: 1.26, sway: 0.24, aura: 0.55, energy: 0.1 },
      level: 0,
    },
  ])("draws every frame when $name", ({ state, motion, level }) => {
    expect(frameIntervalMs({ ...IDLE_AT_REST, ...motion }, state, 0, level)).toBe(0);
  });

  it.each([0, 1.2, 2.4, 7])(
    "keeps an idle ring at rest at time %s, because it does not breathe or sway",
    (time) => {
      expect(frameIntervalMs(IDLE_AT_REST, "idle", time, 0)).toBe(RESTING_FRAME_MS);
    },
  );
});

describe("how much light a ring gives off", () => {
  it.each([
    [48, 0],
    [64, 0],
    [96, 0.5],
    [128, 1],
    [256, 1],
  ])("gives a %spx ring %s of its glow", (width, glow) => {
    expect(glowForSize(width)).toBe(glow);
  });
});

describe("what the next frame does", () => {
  it("keeps a settled idle ring at the resting cadence and scale until ATTENTION_MS has passed", () => {
    expect(restingPlan(IDLE_AT_REST, "idle", 0, 0, ATTENTION_MS - 1)).toEqual({
      intervalMs: RESTING_FRAME_MS,
      resting: true,
      stop: false,
    });
  });

  it("stops a settled idle ring once ATTENTION_MS has passed since the last attention", () => {
    expect(restingPlan(IDLE_AT_REST, "idle", 0, 0, ATTENTION_MS)).toEqual({
      intervalMs: RESTING_FRAME_MS,
      resting: true,
      stop: true,
    });
  });

  it.each<{ name: string; state: OneOrbState; motion: Partial<OrbMotion>; level: number }>([
    { name: "the ring is thinking", state: "thinking", motion: { tilt: 1.12 }, level: 0 },
    { name: "the ring is listening", state: "listening", motion: { tilt: 1.46 }, level: 0 },
    { name: "the ring is speaking", state: "speaking", motion: { tilt: 1.26 }, level: 0 },
    {
      name: "the opening is still lighting the ring",
      state: "idle",
      motion: { reveal: 0.5 },
      level: 0,
    },
    { name: "sound is playing", state: "idle", motion: {}, level: 0.3 },
  ])("never stops or lowers the scale when $name, however long nobody was there", (input) => {
    const plan = restingPlan(
      { ...IDLE_AT_REST, ...input.motion },
      input.state,
      0,
      input.level,
      10 * ATTENTION_MS,
    );
    expect(plan).toEqual({ intervalMs: 0, resting: false, stop: false });
  });
});

describe("the frame budget", () => {
  const slow = SLOW_FRAME_MS + 10;
  const feed = (budget: FrameBudget, frames: number, frameMs: number) =>
    Array.from({ length: frames }).reduce<FrameBudget>(
      (current) => trackFrameTime(current, frameMs),
      budget,
    );

  it("keeps the starting scale while frames arrive on time", () => {
    expect(feed(FRAME_BUDGET_START, 500, SLOW_FRAME_MS).step).toBe(0);
  });

  it("steps down one scale after a run of slow frames", () => {
    expect(feed(FRAME_BUDGET_START, SLOW_FRAMES_BEFORE_STEP_DOWN - 1, slow).step).toBe(0);
    expect(feed(FRAME_BUDGET_START, SLOW_FRAMES_BEFORE_STEP_DOWN, slow).step).toBe(1);
  });

  it("starts counting again when a fast frame breaks the run", () => {
    const almost = feed(FRAME_BUDGET_START, SLOW_FRAMES_BEFORE_STEP_DOWN - 1, slow);
    const broken = trackFrameTime(almost, 16);
    expect(feed(broken, SLOW_FRAMES_BEFORE_STEP_DOWN - 1, slow).step).toBe(0);
  });

  it("does not count a long pause as a slow frame", () => {
    const almost = feed(FRAME_BUDGET_START, SLOW_FRAMES_BEFORE_STEP_DOWN - 1, slow);
    expect(trackFrameTime(almost, 5_000)).toEqual({ step: 0, slowFrames: 0 });
  });

  it("stops at the lowest scale and never moves back up", () => {
    const lowest = feed(
      FRAME_BUDGET_START,
      SLOW_FRAMES_BEFORE_STEP_DOWN * (LARGE_RING_PIXEL_RATIOS.length + 3),
      slow,
    );
    expect(lowest.step).toBe(LARGE_RING_PIXEL_RATIOS.length - 1);
    expect(feed(lowest, 500, 8).step).toBe(LARGE_RING_PIXEL_RATIOS.length - 1);
  });
});

describe("the highest pixel density a ring renders at", () => {
  it("lets a small ring draw at up to four times the pixels at every step, so its rim is averaged", () => {
    expect([0, 1, 2, 5].map((step) => pixelRatioCap(200, step))).toEqual([4, 4, 4, 4]);
  });

  it("lowers a large ring one step at a time and holds at the last", () => {
    expect([0, 1, 2, 9].map((step) => pixelRatioCap(480, step))).toEqual([1.5, 1.25, 1, 1]);
  });
});

describe("whether a frame may draw", () => {
  const ready = {
    visible: true,
    documentHidden: false,
    width: 480,
    height: 480,
    contextAvailable: true,
  };

  it("draws a ring that is visible, sized and has its context", () => {
    expect(canDrawFrame(ready)).toBe(true);
  });

  it.each([
    ["before the first intersection report", { visible: null }],
    ["after the ring scrolled out of view", { visible: false }],
    ["while the tab is hidden", { documentHidden: true }],
    ["inside an element that is display none", { width: 0, height: 0 }],
    ["with no height", { height: 0 }],
    ["while the context is lost", { contextAvailable: false }],
  ])("does not draw %s", (_name, change) => {
    expect(canDrawFrame({ ...ready, ...change })).toBe(false);
  });
});
