import { describe, expect, it } from "vite-plus/test";

import type { ServerProviderUsageWindow } from "@t3tools/contracts";

import { behindPaceGap, limitClock, meterState, projectLimit } from "./usageMeterState";

describe("meterState", () => {
  it.each([
    [100, "comfortable"],
    [26, "comfortable"],
    [25, "low"],
    [11, "low"],
    [10, "critical"],
    [0, "critical"],
  ] as const)("a limit with %i%% left is %s", (remaining, state) => {
    expect(meterState(remaining)).toBe(state);
  });
});

describe("behindPaceGap", () => {
  it.each([
    ["ahead of pace with the marker past the fill", 17, 50, "ahead", { from: 17, to: 50 }],
    ["on pace", 48, 50, "on", null],
    ["under pace", 63, 30, "under", null],
    ["ahead of pace but the marker is not past the fill", 40, 40, "ahead", null],
    ["a window with no clock", 17, null, null, null],
  ] as const)("%s", (_name, remaining, timeLeft, pace, expected) => {
    expect(behindPaceGap(remaining, timeLeft, pace)).toEqual(expected);
  });
});

const HOUR = 3_600_000;
const WEEK = 168 * HOUR;

describe("projectLimit", () => {
  it.each([
    [
      "30% used after 20% of the week, so it empties well before the reset",
      30,
      WEEK,
      0.8 * WEEK,
      "runs-out",
    ],
    ["spending exactly with the clock", 50, WEEK, 0.5 * WEEK, "on-track"],
    ["spending slower than the clock", 40, WEEK, 0.5 * WEEK, "on-track"],
    ["barely used", 2, WEEK, 0.5 * WEEK, "plenty"],
    ["nothing used yet", 0, WEEK, 0.5 * WEEK, "plenty"],
    ["already empty", 100, WEEK, 0.5 * WEEK, "exhausted"],
    ["used with zero time elapsed", 10, WEEK, WEEK, "none"],
    ["a reset that is already past", 60, WEEK, -HOUR, "none"],
    ["a window with no length", 60, null, 3 * HOUR, "none"],
    ["a window with no reset time", 60, WEEK, null, "none"],
  ] as const)("%s", (_name, usedPercent, windowMs, msToReset, kind) => {
    expect(projectLimit({ usedPercent, windowMs, msToReset }).kind).toBe(kind);
  });

  it("gives the time to empty and how long before the reset that is", () => {
    // 83% used after half of a week: 17% left lasts 17/83 of the 84 hours elapsed.
    const projection = projectLimit({ usedPercent: 83, windowMs: WEEK, msToReset: 84 * HOUR });
    expect(projection.kind).toBe("runs-out");
    if (projection.kind !== "runs-out") return;
    expect(projection.runsOutInMs).toBeCloseTo((17 / 83) * 84 * HOUR, 0);
    expect(projection.runsOutInMs + projection.beforeResetMs).toBeCloseTo(84 * HOUR, 0);
  });

  it("treats an arrival within a minute of the reset as on track", () => {
    // Used 50% with 50% elapsed minus a few seconds still ends at the reset.
    expect(projectLimit({ usedPercent: 50.0001, windowMs: WEEK, msToReset: WEEK / 2 }).kind).toBe(
      "on-track",
    );
  });
});

describe("limitClock", () => {
  const window = (resetsInMs: number, usedPercent = 10): ServerProviderUsageWindow => ({
    id: "weekly",
    label: "Weekly",
    kind: "weekly",
    usedPercent,
    resetsAt: new Date(NOW + resetsInMs).toISOString(),
    windowDurationMins: WEEK / 60_000,
  });
  const NOW = Date.parse("2026-10-25T16:00:00.000Z");

  it("reads one window's length and time to reset", () => {
    expect(limitClock([window(2 * 24 * HOUR)], NOW)).toEqual({
      windowMs: WEEK,
      msToReset: 2 * 24 * HOUR,
    });
  });

  it("gives a pool whose accounts reset together the clock they share", () => {
    const clock = limitClock([window(24 * HOUR), window(24 * HOUR + 30_000)], NOW);
    expect(clock?.windowMs).toBe(WEEK);
    expect(clock?.msToReset).toBeCloseTo(24 * HOUR + 15_000, 0);
  });

  it("gives no clock to a pool whose accounts reset at different times", () => {
    // A Plus account about to reset beside a Pro account hours from its own reset: the mean of
    // the two is a time at which nothing resets.
    const fiveHours = 300 * 60_000;
    const short = (resetsInMs: number): ServerProviderUsageWindow => ({
      ...window(resetsInMs),
      windowDurationMins: 300,
    });
    expect(limitClock([short(30 * 60_000), short(fiveHours - 30 * 60_000)], NOW)).toBeNull();
  });

  it("gives no clock to a pool whose windows differ in length", () => {
    expect(
      limitClock([window(2 * HOUR), { ...window(2 * HOUR), windowDurationMins: 300 }], NOW),
    ).toBeNull();
  });

  it("gives no clock to a pool with an untimed account", () => {
    const { windowDurationMins: _length, ...untimed } = window(2 * HOUR);
    expect(limitClock([window(2 * HOUR), untimed], NOW)).toBeNull();
  });

  it("returns null when no window has a clock", () => {
    const { windowDurationMins: _length, ...untimed } = window(HOUR);
    expect(limitClock([untimed], NOW)).toBeNull();
  });
});
