import { describe, expect, it, vi } from "vite-plus/test";

import {
  ATTENTION_MS,
  RESTING_FRAME_MS,
  SLOW_FRAMES_BEFORE_STEP_DOWN,
  startOneOrb,
  type OneOrbState,
} from "./oneOrbRenderer";

/** Just enough of a WebGL context for the ring: every call is recorded, nothing is drawn. */
function createStubGl() {
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    STATIC_DRAW: 6,
    FLOAT: 7,
    TRIANGLES: 8,
    COLOR_BUFFER_BIT: 9,
    contextLost: false,
    isContextLost: () => gl.contextLost,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({})),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    deleteProgram: vi.fn(),
    useProgram: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    deleteBuffer: vi.fn(),
    getAttribLocation: vi.fn(() => 0),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    getUniformLocation: vi.fn(() => ({})),
    uniform1f: vi.fn(),
    uniform2f: vi.fn(),
    uniform3fv: vi.fn(),
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    drawArrays: vi.fn(),
  };
  return gl;
}

/** Fake media query lists, so a test decides reduced motion and the pixel density without a real display. */
function createMedia(options: { reducedMotion: boolean }) {
  const original = window.matchMedia.bind(window);
  const densityListeners = new Set<() => void>();
  const densityQueries: string[] = [];
  const fake = (matches: boolean, listeners = new Set<() => void>()) =>
    ({
      matches,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }) as unknown as MediaQueryList;
  const spy = vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    if (query.includes("prefers-reduced-motion")) return fake(options.reducedMotion);
    if (query.includes("resolution")) {
      densityQueries.push(query);
      // The ring watches one density at a time; a new query replaces the one a change used up.
      densityListeners.clear();
      return fake(true, densityListeners);
    }
    return original(query);
  });
  return {
    densityQueries,
    densityListeners,
    [Symbol.dispose]: () => spy.mockRestore(),
  };
}

/**
 * Replaces everything the ring reads from the page that moves on its own: the GPU context, frames,
 * timers, the clock, intersection reports and the pixel density. A test then steps frames by hand.
 */
function setup(
  options: {
    reducedMotion?: boolean;
    pixelRatio?: number;
    size?: number;
    contextLost?: boolean;
  } = {},
) {
  const gl = createStubGl();
  gl.contextLost = options.contextLost ?? false;
  const cleanups: Array<() => void> = [];
  const own = <T extends Disposable>(value: T): T => {
    cleanups.push(() => value[Symbol.dispose]());
    return value;
  };

  const realGetContext = HTMLCanvasElement.prototype.getContext;
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(function (this: HTMLCanvasElement, ...args: unknown[]) {
      return args[0] === "webgl"
        ? (gl as unknown as WebGLRenderingContext)
        : (realGetContext as (...a: unknown[]) => unknown).apply(this, args);
    } as never);
  cleanups.push(() => getContext.mockRestore());

  const clock = { now: 1_000 };
  const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => clock.now);
  cleanups.push(() => nowSpy.mockRestore());

  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  const caf = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  cleanups.push(
    () => raf.mockRestore(),
    () => caf.mockRestore(),
  );

  // oxlint-disable-next-line t3code/no-frame-waits-in-browser-tests -- this suite tests the ring's own frame scheduler, so it steps frames and its resting timer by hand; nothing here waits on a real frame
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  cleanups.push(() => vi.useRealTimers());

  let report: IntersectionObserverCallback = () => {};
  class FakeIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) {
      report = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  cleanups.push(() => vi.unstubAllGlobals());

  const pixelRatio = vi
    .spyOn(window, "devicePixelRatio", "get")
    .mockReturnValue(options.pixelRatio ?? 1);
  cleanups.push(() => pixelRatio.mockRestore());

  const media = own(createMedia({ reducedMotion: options.reducedMotion ?? false }));

  const canvas = document.createElement("canvas");
  const size = options.size ?? 400;
  canvas.style.cssText = `position:fixed;left:0;top:0;width:${size}px;height:${size}px`;
  document.body.append(canvas);
  cleanups.push(() => canvas.remove());

  /** One display refresh `ms` later: timers that are due fire, then the queued frames run. */
  const step = (ms: number) => {
    clock.now += ms;
    vi.advanceTimersByTime(ms);
    const due = [...frames.values()];
    frames.clear();
    for (const callback of due) callback(clock.now);
  };

  return {
    gl,
    canvas,
    media,
    setPixelRatio: (value: number) => pixelRatio.mockReturnValue(value),
    /** Tells the ring whether it is on screen, as the intersection observer would. */
    intersect: (isIntersecting: boolean) =>
      report([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver),
    pendingFrames: () => frames.size,
    /** Frames or resting timers still waiting; zero means the ring scheduled nothing. */
    pendingWork: () => frames.size + vi.getTimerCount(),
    now: () => clock.now,
    step,
    /** `count` display refreshes, `ms` apart. */
    run: (count: number, ms = 16) => {
      for (let index = 0; index < count; index++) step(ms);
    },
    [Symbol.dispose]: () => {
      for (const cleanup of cleanups.toReversed()) cleanup();
    },
  };
}

function start(
  env: ReturnType<typeof setup>,
  state: OneOrbState = "idle",
  callbacks: { onUnsupported?: () => void; onLost?: () => void; onRestored?: () => void } = {},
) {
  const renderer = startOneOrb(env.canvas, {
    getState: () => state,
    getLevel: () => 0,
    onUnsupported: callbacks.onUnsupported ?? (() => {}),
    ...(callbacks.onLost ? { onContextLost: callbacks.onLost } : {}),
    ...(callbacks.onRestored ? { onContextRestored: callbacks.onRestored } : {}),
  });
  if (!renderer) throw new Error("the ring did not start");
  return renderer;
}

describe("the ring when the GPU context is lost", () => {
  it("stops drawing and keeps the canvas on a lost context, then rebuilds and draws after the restore, without reporting unsupported", () => {
    using env = setup();
    const onUnsupported = vi.fn();
    const onLost = vi.fn();
    const onRestored = vi.fn();
    const orb = start(env, "thinking", { onUnsupported, onLost, onRestored });
    env.intersect(true);
    env.run(3);
    const drawnBeforeLoss = env.gl.drawArrays.mock.calls.length;
    expect(drawnBeforeLoss).toBeGreaterThan(0);

    const lost = new Event("webglcontextlost", { cancelable: true });
    env.canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    // Waking a ring with no GPU objects must not draw either.
    orb.wake();
    env.run(10);
    expect(env.gl.drawArrays.mock.calls.length).toBe(drawnBeforeLoss);
    expect(env.pendingFrames()).toBe(0);
    expect(env.canvas.isConnected).toBe(true);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(onUnsupported).not.toHaveBeenCalled();

    const programsBeforeRestore = env.gl.createProgram.mock.calls.length;
    env.canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(env.gl.createProgram.mock.calls.length).toBe(programsBeforeRestore + 1);
    expect(onRestored).toHaveBeenCalledTimes(1);
    env.run(3);
    expect(env.gl.drawArrays.mock.calls.length).toBeGreaterThan(drawnBeforeLoss);
    expect(onUnsupported).not.toHaveBeenCalled();
    orb.dispose();
  });

  it("waits for the restore when the canvas was already lost at start", () => {
    using env = setup({ contextLost: true });
    const onUnsupported = vi.fn();
    const onLost = vi.fn();
    const orb = start(env, "thinking", { onUnsupported, onLost });
    env.intersect(true);
    env.run(3);
    expect(env.gl.createProgram).not.toHaveBeenCalled();
    expect(env.gl.drawArrays).not.toHaveBeenCalled();
    expect(onLost).toHaveBeenCalledTimes(1);

    env.gl.contextLost = false;
    env.canvas.dispatchEvent(new Event("webglcontextrestored"));
    env.run(3);
    expect(env.gl.drawArrays).toHaveBeenCalled();
    expect(onUnsupported).not.toHaveBeenCalled();
    orb.dispose();
  });

  it("shuts the ring down at once when its canvas has left the page by the time the context is lost", () => {
    using env = setup();
    const onLost = vi.fn();
    start(env, "thinking", { onLost });
    env.intersect(true);
    env.canvas.remove();

    env.canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    const programs = env.gl.createProgram.mock.calls.length;
    env.canvas.dispatchEvent(new Event("webglcontextrestored"));

    expect(onLost).not.toHaveBeenCalled();
    expect(env.gl.createProgram.mock.calls.length).toBe(programs);
    expect(env.pendingFrames()).toBe(0);
  });
});

describe("when the ring may draw", () => {
  it("draws nothing before the first intersection report and starts after it", () => {
    using env = setup();
    const orb = start(env, "thinking");
    // The resize and theme observers wake the ring before the intersection observer has answered.
    orb.wake();
    env.run(5);
    expect(env.gl.drawArrays).not.toHaveBeenCalled();
    expect(env.pendingFrames()).toBe(0);

    env.intersect(true);
    env.run(2);
    expect(env.gl.drawArrays).toHaveBeenCalled();
    orb.dispose();
  });

  it("cancels a queued frame when the ring scrolls out of view", () => {
    using env = setup();
    const orb = start(env, "thinking");
    env.intersect(true);
    expect(env.pendingFrames()).toBe(1);

    env.intersect(false);
    expect(env.pendingFrames()).toBe(0);
    env.run(5);
    expect(env.gl.drawArrays).not.toHaveBeenCalled();
    orb.dispose();
  });

  it("does not draw a frame that was queued before its element became display none", () => {
    using env = setup();
    const orb = start(env, "thinking");
    env.intersect(true);
    expect(env.pendingFrames()).toBe(1);

    env.canvas.style.display = "none";
    env.run(1);
    expect(env.gl.drawArrays).not.toHaveBeenCalled();
    expect(env.pendingFrames()).toBe(0);
    orb.dispose();
  });

  it("does not draw a frame that was queued before the tab was hidden", () => {
    using env = setup();
    const orb = start(env, "thinking");
    env.intersect(true);
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);

    env.run(1);
    hidden.mockRestore();
    expect(env.gl.drawArrays).not.toHaveBeenCalled();
    orb.dispose();
  });

  it("draws one frame per wake under reduced motion and queues no more", () => {
    using env = setup({ reducedMotion: true });
    const orb = start(env, "idle");
    env.intersect(true);
    env.run(5);
    expect(env.gl.drawArrays).toHaveBeenCalledTimes(1);
    expect(env.pendingFrames()).toBe(0);

    orb.wake();
    env.run(5);
    expect(env.gl.drawArrays).toHaveBeenCalledTimes(2);
    orb.dispose();
  });
});

describe("how often the ring draws", () => {
  function drawsOverThreeSeconds(state: OneOrbState) {
    using env = setup();
    const orb = start(env, state);
    env.intersect(true);
    env.run(188);
    const draws = env.gl.drawArrays.mock.calls.length;
    orb.dispose();
    return draws;
  }

  it("draws a settled idle ring about every RESTING_FRAME_MS, far less than every frame", () => {
    const frames = 188;
    const seconds = (frames * 16) / 1000;
    const draws = drawsOverThreeSeconds("idle");
    // Ten frames a second at rest, plus the few full-speed frames while the ring first settles.
    expect(draws).toBeLessThanOrEqual(Math.ceil((seconds * 1000) / RESTING_FRAME_MS) + 15);
    expect(draws).toBeLessThan(frames / 3);
  });

  it("draws a thinking ring on every frame", () => {
    expect(drawsOverThreeSeconds("thinking")).toBe(188);
  });

  it("returns to full speed on the very next frame when the state leaves idle", () => {
    using env = setup();
    let state: OneOrbState = "idle";
    const orb = startOneOrb(env.canvas, {
      getState: () => state,
      getLevel: () => 0,
      onUnsupported: () => {},
    });
    if (!orb) throw new Error("the ring did not start");
    env.intersect(true);
    env.run(100);
    const resting = env.gl.drawArrays.mock.calls.length;
    env.run(6);
    expect(env.gl.drawArrays.mock.calls.length - resting).toBeLessThanOrEqual(1);

    state = "thinking";
    orb.wake();
    const before = env.gl.drawArrays.mock.calls.length;
    env.run(5);
    expect(env.gl.drawArrays.mock.calls.length - before).toBe(5);
    orb.dispose();
  });
});

describe("the backing store scale of a large ring", () => {
  it("steps from 1.5 to 1.25 to 1 after runs of slow frames and never goes back up", () => {
    using env = setup({ pixelRatio: 2, size: 400 });
    const orb = start(env, "thinking");
    env.intersect(true);
    env.run(3, 16);
    expect(env.canvas.width).toBe(600);

    env.run(SLOW_FRAMES_BEFORE_STEP_DOWN + 1, 40);
    expect(env.canvas.width).toBe(500);
    env.run(SLOW_FRAMES_BEFORE_STEP_DOWN, 40);
    expect(env.canvas.width).toBe(400);
    env.run(SLOW_FRAMES_BEFORE_STEP_DOWN * 2, 40);
    expect(env.canvas.width).toBe(400);
    env.run(100, 16);
    expect(env.canvas.width).toBe(400);
    orb.dispose();
  });

  it("keeps the scale while frames arrive on time", () => {
    using env = setup({ pixelRatio: 2, size: 400 });
    const orb = start(env, "thinking");
    env.intersect(true);
    env.run(200, 16);
    expect(env.canvas.width).toBe(600);
    orb.dispose();
  });

  it("does not lower a small ring", () => {
    using env = setup({ pixelRatio: 2, size: 200 });
    const orb = start(env, "thinking");
    env.intersect(true);
    env.run(SLOW_FRAMES_BEFORE_STEP_DOWN * 4, 40);
    expect(env.canvas.width).toBe(400);
    orb.dispose();
  });
});

describe("the ring on a screen with another pixel density", () => {
  it("resizes its backing store and watches the new density when only the density changes", () => {
    using env = setup({ pixelRatio: 2, size: 400 });
    const orb = start(env, "thinking");
    env.intersect(true);
    env.run(2);
    expect(env.canvas.width).toBe(600);
    expect(env.media.densityQueries).toEqual(["(resolution: 2dppx)"]);

    env.setPixelRatio(1);
    // A copy: each listener re-arms itself, which changes the list while it is walked.
    const armed = Array.from(env.media.densityListeners);
    for (const listener of armed) listener();
    expect(env.canvas.width).toBe(400);
    expect(env.media.densityQueries).toEqual(["(resolution: 2dppx)", "(resolution: 1dppx)"]);
    orb.dispose();
  });
});

describe("the ring when nobody is there", () => {
  /** Starts an idle ring and lets it settle, then returns the time its attention started. */
  function startResting(env: ReturnType<typeof setup>, state: () => OneOrbState = () => "idle") {
    const orb = startOneOrb(env.canvas, {
      getState: state,
      getLevel: () => 0,
      onUnsupported: () => {},
    });
    if (!orb) throw new Error("the ring did not start");
    env.intersect(true);
    return orb;
  }
  const drawCount = (env: ReturnType<typeof setup>) => env.gl.drawArrays.mock.calls.length;

  it("draws exactly one frame after ATTENTION_MS without activity, then schedules nothing", () => {
    using env = setup();
    const drawnAt: number[] = [];
    env.gl.drawArrays.mockImplementation(() => {
      drawnAt.push(env.now());
    });
    const orb = startResting(env);
    const startedAt = env.now();

    env.run(Math.ceil((ATTENTION_MS + 1000) / 10), 10);

    const late = drawnAt.filter((at) => at - startedAt >= ATTENTION_MS);
    expect(late).toHaveLength(1);
    expect(drawnAt.at(-1)).toBe(late[0]);
    // The ring kept moving until then: about one frame per RESTING_FRAME_MS.
    expect(drawnAt.length).toBeGreaterThan(ATTENTION_MS / RESTING_FRAME_MS / 2);
    expect(env.pendingWork()).toBe(0);
    const drawn = drawCount(env);
    env.run(200, 16);
    expect(drawCount(env)).toBe(drawn);
    orb.dispose();
  });

  it.each(["pointermove", "pointerdown", "keydown", "wheel", "focus"])(
    "draws again after a %s event woke a ring that had stopped, and stops again ATTENTION_MS later",
    (type) => {
      using env = setup();
      const orb = startResting(env);
      env.run(Math.ceil((ATTENTION_MS + 500) / 10), 10);
      expect(env.pendingWork()).toBe(0);
      const asleep = drawCount(env);

      window.dispatchEvent(new Event(type));
      env.run(Math.ceil((ATTENTION_MS - 500) / 10), 10);
      expect(drawCount(env) - asleep).toBeGreaterThan(20);
      expect(env.pendingWork()).toBeGreaterThan(0);

      env.run(Math.ceil(1000 / 10), 10);
      expect(env.pendingWork()).toBe(0);
      orb.dispose();
    },
  );

  it("draws again after wake() woke a ring that had stopped", () => {
    using env = setup();
    const orb = startResting(env);
    env.run(Math.ceil((ATTENTION_MS + 500) / 10), 10);
    const asleep = drawCount(env);

    orb.wake();
    env.run(10, 10);
    expect(drawCount(env) - asleep).toBeGreaterThan(0);
    expect(env.pendingWork()).toBeGreaterThan(0);
    orb.dispose();
  });

  it("keeps an awake ring going past ATTENTION_MS when activity keeps arriving, without drawing for the activity", () => {
    using env = setup();
    const orb = startResting(env);
    env.run(Math.ceil((ATTENTION_MS - 1000) / 10), 10);
    const before = drawCount(env);
    const pending = env.pendingWork();

    window.dispatchEvent(new Event("pointermove"));
    expect(drawCount(env)).toBe(before);
    expect(env.pendingWork()).toBe(pending);

    env.run(Math.ceil(2000 / 10), 10);
    expect(env.pendingWork()).toBeGreaterThan(0);
    env.run(Math.ceil((ATTENTION_MS - 1000) / 10), 10);
    expect(env.pendingWork()).toBe(0);
    orb.dispose();
  });

  it("removes every activity listener it added once disposed", () => {
    using env = setup();
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    const orb = startResting(env);
    const attention = (calls: ReadonlyArray<readonly unknown[]>) =>
      calls.filter(([type]) =>
        ["pointermove", "pointerdown", "keydown", "wheel", "focus"].includes(String(type)),
      );
    expect(attention(added.mock.calls)).toHaveLength(5);

    orb.dispose();

    const listeners = attention(added.mock.calls).map(([type, listener]) => [type, listener]);
    expect(attention(removed.mock.calls).map(([type, listener]) => [type, listener])).toEqual(
      listeners,
    );
    added.mockRestore();
    removed.mockRestore();
  });

  it("keeps drawing a thinking ring on every frame long after ATTENTION_MS", () => {
    using env = setup();
    const orb = startResting(env, () => "thinking");
    const frames = Math.ceil((ATTENTION_MS * 2) / 16);

    env.run(frames, 16);
    expect(drawCount(env)).toBe(frames);
    expect(env.pendingFrames()).toBe(1);
    orb.dispose();
  });

  it("keeps drawing an idle ring that is still easing toward its pose when ATTENTION_MS has already passed, then stops it once settled", () => {
    using env = setup();
    let state: OneOrbState = "thinking";
    const orb = startResting(env, () => state);
    env.run(Math.ceil((ATTENTION_MS + 500) / 16), 16);
    // The state changes without a wake: the spin and the corona still have to ease to rest.
    state = "idle";
    const before = drawCount(env);

    env.run(30, 16);
    expect(drawCount(env) - before).toBe(30);
    expect(env.pendingWork()).toBeGreaterThan(0);

    env.run(Math.ceil(8000 / 16), 16);
    expect(env.pendingWork()).toBe(0);
    orb.dispose();
  });
});

describe("the backing store scale of a resting ring", () => {
  it("keeps a resting ring at its full resolution, so the frame that stays on screen is sharp", () => {
    using env = setup({ pixelRatio: 2, size: 200 });
    const orb = startOneOrb(env.canvas, {
      getState: () => "idle",
      getLevel: () => 0,
      onUnsupported: () => {},
    });
    if (!orb) throw new Error("the ring did not start");
    env.intersect(true);
    expect(env.canvas.width).toBe(400);
    for (let frame = 0; frame < 60; frame++) env.step(16);
    expect(env.canvas.width).toBe(400);
    orb.dispose();
  });
});
