import { describe, expect, it } from "vite-plus/test";

import { setPendingAgentContext, takePendingAgentContext } from "./pendingAgentContext";

describe("the app's notes for a composer's next message", () => {
  it("go with exactly one send and only from the composer they were set for", () => {
    setPendingAgentContext("thread-a", "Notes for a");
    expect(takePendingAgentContext("thread-b")).toBeUndefined();
    expect(takePendingAgentContext("thread-a")).toBe("Notes for a");
    // A later message from the same composer, such as one typed by hand, carries none.
    expect(takePendingAgentContext("thread-a")).toBeUndefined();
  });
});
