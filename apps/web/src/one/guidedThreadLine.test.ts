import { describe, expect, it } from "vite-plus/test";

import { liveGuidedInfo } from "./guidedThreadLine";

const stored = {
  asked: "Claude",
  skipped: { name: "Codex", resetsAt: "2026-11-26T19:15:00.000Z" },
  actions: [{ label: "Open Usage", href: "/usage" }],
};
const before = Date.parse("2026-11-26T18:00:00.000Z");
const after = Date.parse("2026-11-26T19:16:00.000Z");

describe("liveGuidedInfo", () => {
  it("says which provider produced the first answer, not the one the thread started on", () => {
    expect(
      liveGuidedInfo({
        stored,
        firstAnswerProvider: "Opus 5.5 account",
        answeredRuns: 1,
        now: before,
      })?.asked,
    ).toBe("Opus 5.5 account");
    expect(
      liveGuidedInfo({ stored, firstAnswerProvider: null, answeredRuns: 0, now: before })?.asked,
    ).toBe("Claude");
  });

  it("mentions a passed-over provider only until its usage returns", () => {
    expect(
      liveGuidedInfo({ stored, firstAnswerProvider: null, answeredRuns: 0, now: before })?.skipped,
    ).toEqual(stored.skipped);
    expect(
      liveGuidedInfo({ stored, firstAnswerProvider: null, answeredRuns: 1, now: after })?.skipped,
    ).toBeUndefined();
  });

  it("says nothing once a second run has answered", () => {
    expect(
      liveGuidedInfo({ stored, firstAnswerProvider: "Claude", answeredRuns: 2, now: before }),
    ).toBeNull();
    expect(
      liveGuidedInfo({ stored: null, firstAnswerProvider: null, answeredRuns: 0, now: before }),
    ).toBeNull();
  });
});
