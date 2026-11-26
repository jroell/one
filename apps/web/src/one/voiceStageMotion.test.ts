import { describe, expect, it } from "vite-plus/test";

import { SWELL_REACH, flightTo, smoothSwell, swellScale } from "./voiceStageMotion";

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
