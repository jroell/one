import { describe, expect, it } from "vite-plus/test";

import {
  SWELL_REACH,
  flightTo,
  irisCoverMs,
  irisGeometry,
  smoothSwell,
  swellScale,
} from "./voiceStageMotion";

const frames = (start: number, target: number, count: number, dt: number) => {
  const values = [start];
  for (let index = 0; index < count; index += 1) {
    values.push(smoothSwell(values.at(-1)!, target, dt));
  }
  return values;
};

describe("how the ring's swell follows the sound", () => {
  it("rises faster than it falls, covering most of a rise within 6 frames at 60 Hz", () => {
    const rise = frames(0, 1, 6, 1 / 60).at(-1)!;
    const fall = 1 - frames(1, 0, 6, 1 / 60).at(-1)!;
    expect(rise).toBeGreaterThan(0.85);
    expect(rise).toBeGreaterThan(fall * 1.3);
  });

  it("reaches the same place whatever the frame rate", () => {
    const at60 = frames(0, 1, 30, 1 / 60).at(-1)!;
    const at120 = frames(0, 1, 60, 1 / 120).at(-1)!;
    expect(at120).toBeCloseTo(at60, 1);
  });

  it("treats a long gap, such as a hidden tab, as one short frame", () => {
    expect(smoothSwell(0, 1, 30)).toBe(smoothSwell(0, 1, 0.05));
  });

  it("stays between the old value and the target and lands exactly on a target it is next to", () => {
    expect(smoothSwell(0.2, 0.9, 1 / 60)).toBeGreaterThan(0.2);
    expect(smoothSwell(0.2, 0.9, 1 / 60)).toBeLessThan(0.9);
    expect(smoothSwell(0.999, 1, 1 / 60)).toBe(1);
    expect(smoothSwell(0.001, 0, 1 / 60)).toBe(0);
  });

  it("scales the ring by at most 8 percent however loud the input", () => {
    expect(swellScale(1, SWELL_REACH)).toBe("scale(1.0800)");
    expect(swellScale(5, SWELL_REACH)).toBe("scale(1.0800)");
    expect(swellScale(-1, SWELL_REACH)).toBe("scale(1.0000)");
  });
});

describe("where the ring flies from and to", () => {
  const orb = { left: 400, top: 100, width: 300, height: 300 };

  it("moves the orb's center to the control's center and shrinks it to the control's size", () => {
    const control = { left: 20, top: 640, width: 36, height: 36 };
    expect(flightTo(orb, control)).toEqual({ dx: 20 + 18 - 550, dy: 640 + 18 - 250, scale: 0.12 });
  });

  it("never shrinks to nothing or stays large for a wide control such as the composer", () => {
    expect(flightTo(orb, { left: 0, top: 0, width: 4, height: 4 }).scale).toBe(0.05);
    expect(flightTo(orb, { left: 0, top: 0, width: 700, height: 600 }).scale).toBe(0.4);
  });
});

const ENTER = "cubic-bezier(0.2, 0.9, 0.1, 1)";

describe("when the disc reaches a point", () => {
  const iris = { cx: 0, cy: 0, radius: 1000 };

  it("reaches half of its radius in about a tenth of its time, because the easing starts fast", () => {
    expect(irisCoverMs(iris, 500, 320, ENTER)).toBeCloseTo(34, -1);
  });

  it("spends the last few percent of its radius in a long tail", () => {
    expect(irisCoverMs(iris, 990, 320, ENTER)).toBeGreaterThan(190);
  });

  it("is at the end of its time at its full radius and no later for a point beyond it", () => {
    expect(irisCoverMs(iris, 1000, 320, ENTER)).toBeCloseTo(320, 0);
    expect(irisCoverMs(iris, 2000, 320, ENTER)).toBeCloseTo(320, 0);
  });

  it("reads an easing it cannot parse as a straight line", () => {
    expect(irisCoverMs(iris, 300, 100, "ease-out")).toBeCloseTo(30, 0);
  });
});

describe("the disc the dark stage grows from", () => {
  const viewport = { width: 1440, height: 900 };
  const control = { left: 1200, top: 12, width: 28, height: 28 };

  it("is centred on the control", () => {
    const iris = irisGeometry(control, viewport, ENTER);
    expect([iris.cx, iris.cy]).toEqual([1214, 26]);
  });

  it("reaches the farthest corner of the window by the time it is meant to, not in the tail", () => {
    const iris = irisGeometry(control, viewport, ENTER);
    const far = Math.hypot(1214, 874);
    // The radius is a little more than the corner distance, and the corner is covered at 60 percent of
    // its time, about 190 ms of 320.
    expect(iris.radius).toBeGreaterThan(far);
    expect(iris.radius).toBeLessThan(far * 1.05);
    expect(irisCoverMs(iris, far, 320, ENTER)).toBeGreaterThan(150);
    expect(irisCoverMs(iris, far, 320, ENTER)).toBeLessThan(200);
  });

  it("covers every corner from any position of the control", () => {
    for (const box of [
      { left: 0, top: 0, width: 20, height: 20 },
      { left: 700, top: 440, width: 40, height: 40 },
      { left: 1420, top: 880, width: 20, height: 20 },
    ]) {
      const iris = irisGeometry(box, viewport, ENTER);
      for (const [x, y] of [
        [0, 0],
        [1440, 0],
        [0, 900],
        [1440, 900],
      ] as const) {
        expect(Math.hypot(x - iris.cx, y - iris.cy)).toBeLessThanOrEqual(iris.radius);
      }
    }
  });
});
