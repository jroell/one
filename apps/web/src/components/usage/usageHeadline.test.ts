import { describe, expect, it } from "vite-plus/test";

import { inlineWindowName, tightestLimit, type LimitCandidate } from "./usageHeadline";

const HOUR = 3_600_000;

const limit = (
  subject: string,
  remainingPercent: number,
  projection: LimitCandidate<string>["projection"],
): LimitCandidate<string> => ({ subject, remainingPercent, projection });

describe("tightestLimit", () => {
  it("picks the limit that runs out soonest, not the one with the least left", () => {
    const watched = tightestLimit([
      limit("low but slow", 8, { kind: "on-track" }),
      limit("burning", 60, { kind: "runs-out", runsOutInMs: 5 * HOUR, beforeResetMs: 20 * HOUR }),
      limit("later", 30, { kind: "runs-out", runsOutInMs: 40 * HOUR, beforeResetMs: 2 * HOUR }),
    ]);
    expect(watched?.subject).toBe("burning");
  });

  it("puts a limit that is already used up first", () => {
    const watched = tightestLimit([
      limit("burning", 20, { kind: "runs-out", runsOutInMs: HOUR, beforeResetMs: HOUR }),
      limit("empty", 0, { kind: "exhausted" }),
    ]);
    expect(watched?.subject).toBe("empty");
  });

  it("falls back to the least left when nothing runs out, and to list order on a tie", () => {
    expect(
      tightestLimit([
        limit("a", 70, { kind: "plenty" }),
        limit("b", 40, { kind: "on-track" }),
        limit("c", 40, { kind: "none" }),
      ])?.subject,
    ).toBe("b");
  });

  it("has nothing to pick from an empty page", () => {
    expect(tightestLimit([])).toBeUndefined();
  });
});

describe("inlineWindowName", () => {
  it.each([
    ["Weekly", "weekly"],
    ["Session", "session"],
    ["Weekly · Fable", "weekly · Fable"],
    ["Opus allowance", "Opus allowance"],
    ["Gemini-3 Pro", "Gemini-3 Pro"],
  ])("%s reads %s inside a sentence", (label, expected) => {
    expect(inlineWindowName(label)).toBe(expected);
  });
});
