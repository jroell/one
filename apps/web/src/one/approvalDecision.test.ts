import { RuntimeRequestId } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  answerApproval,
  clearApprovalDecision,
  peekApprovalDecision,
  pruneApprovalDecisions,
} from "./approvalDecision";

const request = RuntimeRequestId.make("request-a");
const other = RuntimeRequestId.make("request-b");

afterEach(() => {
  clearApprovalDecision(request);
  clearApprovalDecision(other);
});

describe("answerApproval", () => {
  it("keeps the answer while the request is being answered and once it was accepted", async () => {
    let seen: string | undefined;
    await answerApproval(request, "accept", async () => {
      seen = peekApprovalDecision(request);
      return { _tag: "Success" };
    });
    expect(seen).toBe("accept");
    expect(peekApprovalDecision(request)).toBe("accept");
  });

  it("takes the answer back when the send comes back as a failure result", async () => {
    // A refused answer resolves with a failure; it does not reject.
    await answerApproval(request, "accept", async () => ({ _tag: "Failure" }));
    expect(peekApprovalDecision(request)).toBeUndefined();
  });

  it("takes the answer back when the send rejects", async () => {
    await answerApproval(request, "decline", async () => {
      throw new Error("offline");
    });
    expect(peekApprovalDecision(request)).toBeUndefined();
  });

  it("does not lose the answer of another request that failed", async () => {
    await answerApproval(other, "decline", async () => ({ _tag: "Success" }));
    await answerApproval(request, "accept", async () => ({ _tag: "Failure" }));
    expect(peekApprovalDecision(other)).toBe("decline");
    clearApprovalDecision(other);
  });
});

describe("pruneApprovalDecisions", () => {
  it("drops the answers of shown requests that are neither waiting nor leaving", async () => {
    await answerApproval(request, "accept", async () => ({ _tag: "Success" }));
    await answerApproval(other, "decline", async () => ({ _tag: "Success" }));
    pruneApprovalDecisions([request, other], (id) => id === other);
    expect(peekApprovalDecision(request)).toBeUndefined();
    expect(peekApprovalDecision(other)).toBe("decline");
  });

  it("keeps the answer of a request the pruning timeline never showed", async () => {
    // A side chat prunes with its own requests; the main thread's answer is still being sent.
    await answerApproval(request, "accept", async () => ({ _tag: "Success" }));
    pruneApprovalDecisions([other], () => false);
    expect(peekApprovalDecision(request)).toBe("accept");
  });
});
