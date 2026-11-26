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

afterEach(() => pruneApprovalDecisions(() => false));

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
  it("drops the answers of requests that are neither waiting nor leaving", async () => {
    await answerApproval(request, "accept", async () => ({ _tag: "Success" }));
    await answerApproval(other, "decline", async () => ({ _tag: "Success" }));
    pruneApprovalDecisions((id) => id === other);
    expect(peekApprovalDecision(request)).toBeUndefined();
    expect(peekApprovalDecision(other)).toBe("decline");
  });
});
