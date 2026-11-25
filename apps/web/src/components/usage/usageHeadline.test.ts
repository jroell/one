import { describe, expect, it } from "vite-plus/test";

import { decodeOptions } from "gt-react";
import type { MessageResolver } from "~/i18n/messages";

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

  it("ranks a limit with nothing left above forecasts, even without a valid clock", () => {
    // An HTTP quota at 100% used with a reset date and no duration has no projection at all.
    const watched = tightestLimit([
      limit("healthy with a forecast", 75, {
        kind: "runs-out",
        runsOutInMs: 3 * HOUR,
        beforeResetMs: HOUR,
      }),
      limit("empty without a clock", 0, { kind: "none" }),
    ]);
    expect(watched?.subject).toBe("empty without a clock");
  });

  it("ranks on the raw quota left, so a sliver never ties with an empty quota", () => {
    const watched = tightestLimit([
      limit("almost empty", 0.4, { kind: "none" }),
      limit("empty", 0, { kind: "none" }),
    ]);
    expect(watched?.subject).toBe("empty");
  });

  it("has nothing to pick from an empty page", () => {
    expect(tightestLimit([])).toBeUndefined();
  });
});

/** A French catalog for the names under test, looked up by the English source text. */
const french = ((message: string | null | undefined) => {
  const source = decodeOptions(message ?? "")?.$_source ?? message ?? "";
  const catalog: Record<string, string> = {
    weekly: "hebdomadaire",
    session: "session",
    "monthly credit limit": "limite de crédit mensuelle",
    "Cursor models": "modèles Cursor",
  };
  return catalog[source as string] ?? (source as string);
}) as MessageResolver;

describe("inlineWindowName", () => {
  const window = (label: string, id: string, kind: string, native = true) => ({
    label,
    id,
    kind,
    native,
  });

  it("passes a built-in name through the translation, in French as well as English", () => {
    expect(inlineWindowName(window("Weekly", "seven_day", "weekly"), french)).toBe("hebdomadaire");
    expect(inlineWindowName(window("Weekly", "seven_day", "weekly"))).toBe("weekly");
    expect(inlineWindowName(window("Monthly credit limit", "individual", "monthly"), french)).toBe(
      "limite de crédit mensuelle",
    );
    expect(inlineWindowName(window("Cursor Models", "autoPercentUsed", "other"), french)).toBe(
      "modèles Cursor",
    );
  });

  it("translates the base of a model-specific window and keeps the model as sent", () => {
    expect(inlineWindowName(window("Weekly · Fable", "fable", "weekly"), french)).toBe(
      "hebdomadaire · Fable",
    );
    expect(inlineWindowName(window("Weekly · Fable", "fable", "weekly"))).toBe("weekly · Fable");
  });

  it("never rewrites an external source's label, even one spelled like a built-in on the same kind", () => {
    expect(inlineWindowName(window("Weekly", "seven_day", "weekly", false), french)).toBe("Weekly");
    expect(inlineWindowName(window("Subscription", "plan", "other", false), french)).toBe(
      "Subscription",
    );
    expect(
      inlineWindowName(window("Monthly credit limit", "individual", "monthly", false), french),
    ).toBe("Monthly credit limit");
  });

  it("keeps a name a source defined, even when it borrows a built-in word", () => {
    expect(inlineWindowName(window("Opus allowance", "opus", "other"), french)).toBe(
      "Opus allowance",
    );
    expect(inlineWindowName(window("Gemini-3 Pro", "gemini-3", "other"), french)).toBe(
      "Gemini-3 Pro",
    );
    // The label "Weekly" on an id and kind the app does not use for it is the source's own name.
    expect(inlineWindowName(window("Weekly", "custom", "other"), french)).toBe("Weekly");
  });
});
