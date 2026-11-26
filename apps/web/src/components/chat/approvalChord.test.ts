import { describe, expect, it } from "vite-plus/test";

import { chordApprovalRequestId } from "./approvalChord";

describe("chordApprovalRequestId", () => {
  it("answers the oldest waiting request", () => {
    expect(chordApprovalRequestId(["x", "y"], undefined)).toBe("x");
  });

  it("never answers a request the typing guard holds hidden, even when it is the only one left", () => {
    // X is answered while Y was held: no card shows Y, so no chord may approve it.
    expect(chordApprovalRequestId(["y"], new Set(["y"]))).toBeNull();
    expect(chordApprovalRequestId(["x", "y"], new Set(["x"]))).toBe("y");
  });

  it("skips a request that is already leaving, so the chord goes to the next card", () => {
    expect(chordApprovalRequestId(["x", "y"], new Map([["x", "accept"]]))).toBe("y");
  });

  it("answers nothing when nothing waits", () => {
    expect(chordApprovalRequestId([], new Set())).toBeNull();
  });
});
