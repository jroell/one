import { describe, expect, it } from "vite-plus/test";

import { resolveThreadSyncPhase, threadTranscriptMayLag } from "./threadSync";

describe("resolveThreadSyncPhase", () => {
  it("reports a failed sync instead of syncing over cached messages", () => {
    expect(
      resolveThreadSyncPhase({
        detailExists: true,
        shellExists: true,
        status: "cached",
        hasError: true,
      }),
    ).toBe("failed");
    expect(
      resolveThreadSyncPhase({
        detailExists: false,
        shellExists: true,
        status: "synchronizing",
        hasError: true,
      }),
    ).toBe("loading");
    expect(
      resolveThreadSyncPhase({
        detailExists: true,
        shellExists: true,
        status: "synchronizing",
        hasError: false,
      }),
    ).toBe("syncing");
  });
});

describe("sync status for outstanding and dormant threads", () => {
  const base = { detailExists: true, shellExists: true, hasError: false } as const;

  it("keeps the line while a live subscription is still catching up", () => {
    expect(resolveThreadSyncPhase({ ...base, status: "synchronizing" })).toBe("syncing");
  });

  it("shows no line for a dormant cached thread with nothing outstanding", () => {
    expect(resolveThreadSyncPhase({ ...base, status: "cached" })).toBeNull();
    expect(resolveThreadSyncPhase({ ...base, status: "empty" })).toBeNull();
    expect(resolveThreadSyncPhase({ ...base, status: "live" })).toBeNull();
  });

  it("still marks a dormant cached transcript as possibly behind", () => {
    expect(threadTranscriptMayLag({ shellExists: true, status: "cached" })).toBe(true);
    expect(threadTranscriptMayLag({ shellExists: true, status: "live" })).toBe(false);
    expect(threadTranscriptMayLag({ shellExists: false, status: "cached" })).toBe(false);
  });
});
