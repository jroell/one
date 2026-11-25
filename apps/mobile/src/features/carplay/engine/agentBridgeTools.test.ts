import { describe, expect, it, vi } from "vite-plus/test";

import {
  AGENT_BRIDGE_TOOLS,
  AgentBridgeService,
  MAX_PROPOSAL_MESSAGE_CHARS,
  resolveThread,
  type AgentBridgeBackend,
} from "./agentBridgeTools";
import type { BridgeThreadSummary } from "./types";

const AUTH: BridgeThreadSummary = {
  environmentId: "env-mac",
  threadId: "thread-auth",
  title: "Refactor OAuth retry queue",
  status: "needs_approval",
  pendingApprovalCount: 1,
  lastActivityLabel: "Needs Approval",
  branch: "fix/oauth-retry",
};
const UI: BridgeThreadSummary = {
  environmentId: "env-mac",
  threadId: "thread-ui",
  title: "Polish CarPlay voice orb",
  status: "running",
  pendingApprovalCount: 0,
  lastActivityLabel: "Running",
  branch: "feat/carplay",
};
const RELEASE_MAC: BridgeThreadSummary = {
  environmentId: "env-mac",
  threadId: "thread-release-a",
  title: "Release",
  status: "ready",
  pendingApprovalCount: 0,
  lastActivityLabel: "Ready",
};
const RELEASE_PC: BridgeThreadSummary = {
  environmentId: "env-pc",
  threadId: "thread-release-b",
  title: "Release",
  status: "ready",
  pendingApprovalCount: 0,
  lastActivityLabel: "Ready",
};

function createFakeBackend(options: { readonly connected?: boolean } = {}) {
  const connected = options.connected ?? true;
  const threads = [AUTH, UI, RELEASE_MAC, RELEASE_PC];
  const sendMessageToThread = vi.fn(async () => ({ ok: true }));
  const backend: AgentBridgeBackend = {
    isConnected: () => connected,
    listThreads: () => (connected ? threads : []),
    listThreadsForLookup: () => (connected ? threads : []),
    getThreadDetail: (ref) => {
      if (ref.environmentId !== AUTH.environmentId || ref.threadId !== AUTH.threadId) return null;
      return {
        thread: AUTH,
        recentMessages: [
          { role: "assistant", text: "Tests passed after adding exponential backoff." },
        ],
        pendingApprovals: [
          {
            environmentId: "env-mac",
            threadId: "thread-auth",
            threadTitle: AUTH.title,
            requestId: "req-101",
            summary: "Run pnpm test in apps/server",
          },
        ],
      };
    },
    listPendingApprovals: () => [
      {
        environmentId: "env-mac",
        threadId: "thread-auth",
        threadTitle: AUTH.title,
        requestId: "req-101",
        summary: "Run pnpm test in apps/server",
      },
    ],
    sendMessageToThread,
  };
  return { backend, sendMessageToThread };
}

describe("AgentBridgeService", () => {
  it("falls back gracefully when no One computer is connected", async () => {
    const service = new AgentBridgeService(createFakeBackend({ connected: false }).backend);
    const result = await service.executeTool("list_active_threads", {});
    expect(result.ok).toBe(true);
    expect(result.status).toBe("disconnected");
    expect(result.spokenSummary).toContain("No computer is linked");
  });

  it("summarizes threads and pending approvals in plain spoken English", async () => {
    const service = new AgentBridgeService(createFakeBackend().backend);

    const listResult = await service.executeTool("list_active_threads", {});
    expect(listResult.status).toBe("completed");
    expect(listResult.spokenSummary).toContain("4 active threads");
    expect(listResult.spokenSummary).toContain("Refactor OAuth retry queue");

    const summaryResult = await service.executeTool("get_thread_summary", { threadId: "oauth" });
    expect(summaryResult.status).toBe("completed");
    expect(summaryResult.spokenSummary).toContain("Tests passed after adding exponential backoff");
    expect(summaryResult.spokenSummary).toContain("Run pnpm test in apps/server");
  });

  it("never sends from a tool call, whatever confirmation arguments the model supplies", async () => {
    const { backend, sendMessageToThread } = createFakeBackend();
    const service = new AgentBridgeService(backend, () => 1_000);

    const first = await service.executeTool("send_message_to_thread", {
      threadId: "thread-auth",
      message: "Also add a unit test for 429 responses",
      confirmed: true,
    });
    expect(first.status).toBe("needs_confirmation");
    expect(first.confirmation?.message).toBe("Also add a unit test for 429 responses");

    // Replaying the proposal id and the confirmed flag still only re-proposes.
    const second = await service.executeTool("send_message_to_thread", {
      threadId: "thread-auth",
      message: "Also add a unit test for 429 responses",
      confirmed: true,
      confirmationId: first.confirmation!.id,
      confirm: true,
      proposalId: first.confirmation!.id,
    });
    expect(second.status).toBe("needs_confirmation");
    expect(sendMessageToThread).not.toHaveBeenCalled();
  });

  it("sends exactly the proposed text to the proposed thread when the current proposal id is tapped", async () => {
    const { backend, sendMessageToThread } = createFakeBackend();
    const service = new AgentBridgeService(backend, () => 1_000);

    const proposal = await service.executeTool("send_message_to_thread", {
      threadId: "oauth",
      message: "  Also add a unit test for 429 responses  ",
    });
    // The readback carries the whole message, not a clipped snippet.
    expect(proposal.spokenSummary).toContain('"Also add a unit test for 429 responses"');

    const sent = await service.confirmProposal(proposal.confirmation!.id);
    expect(sent.status).toBe("completed");
    expect(sendMessageToThread).toHaveBeenCalledTimes(1);
    expect(sendMessageToThread).toHaveBeenCalledWith(
      { environmentId: "env-mac", threadId: "thread-auth" },
      "Also add a unit test for 429 responses",
    );
    expect(service.getPendingConfirmation()).toBeNull();

    // The same tap again finds nothing to send.
    const again = await service.confirmProposal(proposal.confirmation!.id);
    expect(again.ok).toBe(false);
    expect(sendMessageToThread).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for a stale proposal id and invalidates the old id when a new proposal replaces it", async () => {
    const { backend, sendMessageToThread } = createFakeBackend();
    const service = new AgentBridgeService(backend, () => 1_000);

    const proposalA = await service.executeTool("send_message_to_thread", {
      threadId: "thread-auth",
      message: "Message A",
    });
    const proposalB = await service.executeTool("send_message_to_thread", {
      threadId: "thread-ui",
      message: "Message B",
    });
    expect(proposalB.data).toMatchObject({ replacedProposalId: proposalA.confirmation!.id });
    expect(proposalB.spokenSummary).toContain("replaces");

    const staleTap = await service.confirmProposal(proposalA.confirmation!.id);
    expect(staleTap.ok).toBe(false);
    expect(sendMessageToThread).not.toHaveBeenCalled();
    // The failed stale tap leaves the current proposal waiting.
    expect(service.getPendingConfirmation()?.id).toBe(proposalB.confirmation!.id);

    await service.confirmProposal(proposalB.confirmation!.id);
    expect(sendMessageToThread).toHaveBeenCalledTimes(1);
    expect(sendMessageToThread).toHaveBeenCalledWith(
      { environmentId: "env-mac", threadId: "thread-ui" },
      "Message B",
    );
  });

  it("rejects an expired proposal at execution time and drops it from the pending state", async () => {
    let clock = 1_000;
    const { backend, sendMessageToThread } = createFakeBackend();
    const service = new AgentBridgeService(backend, () => clock);

    const proposal = await service.executeTool("send_message_to_thread", {
      threadId: "thread-auth",
      message: "Ship it",
    });
    expect(service.getPendingConfirmation()?.id).toBe(proposal.confirmation!.id);

    clock = proposal.confirmation!.expiresAt;
    const tap = await service.confirmProposal(proposal.confirmation!.id);
    expect(tap.ok).toBe(false);
    expect(sendMessageToThread).not.toHaveBeenCalled();
    expect(service.getPendingConfirmation()).toBeNull();
  });

  it("refuses a message too long to read back whole and says the limit", async () => {
    const { backend, sendMessageToThread } = createFakeBackend();
    const service = new AgentBridgeService(backend, () => 1_000);

    const tooLong = "x".repeat(MAX_PROPOSAL_MESSAGE_CHARS + 1);
    const result = await service.executeTool("send_message_to_thread", {
      threadId: "thread-auth",
      message: tooLong,
    });
    expect(result.ok).toBe(false);
    expect(result.spokenSummary).toContain(String(MAX_PROPOSAL_MESSAGE_CHARS));
    expect(service.getPendingConfirmation()).toBeNull();
    expect(sendMessageToThread).not.toHaveBeenCalled();

    const atLimit = await service.executeTool("send_message_to_thread", {
      threadId: "thread-auth",
      message: "x".repeat(MAX_PROPOSAL_MESSAGE_CHARS),
    });
    expect(atLimit.status).toBe("needs_confirmation");
    expect(atLimit.confirmation?.message).toHaveLength(MAX_PROPOSAL_MESSAGE_CHARS);
  });

  it("does not offer approvals as a tool and answers any approval request with where to approve", async () => {
    const { backend, sendMessageToThread } = createFakeBackend();
    const service = new AgentBridgeService(backend, () => 1_000);

    expect(AGENT_BRIDGE_TOOLS.map((tool) => tool.name)).not.toContain("respond_to_approval");

    for (const decision of ["accept", "acceptForSession", "decline"]) {
      const result = await service.executeTool("respond_to_approval", {
        threadId: "thread-auth",
        requestId: "req-101",
        decision,
        confirmed: true,
      });
      expect(result.ok).toBe(false);
      expect(result.spokenSummary).toContain("One app");
      expect(service.getPendingConfirmation()).toBeNull();
    }
    expect(sendMessageToThread).not.toHaveBeenCalled();
  });

  it("asks which thread when a spoken title matches several, and carries the environment once it is named", async () => {
    const { backend } = createFakeBackend();
    const service = new AgentBridgeService(backend, () => 1_000);

    const ambiguous = await service.executeTool("send_message_to_thread", {
      threadId: "Release",
      message: "Cut the tag",
    });
    expect(ambiguous.status).toBe("ambiguous");
    expect(service.getPendingConfirmation()).toBeNull();
    expect(ambiguous.data).toMatchObject({
      matches: [
        { environmentId: "env-mac", threadId: "thread-release-a" },
        { environmentId: "env-pc", threadId: "thread-release-b" },
      ],
    });

    const named = await service.executeTool("send_message_to_thread", {
      threadId: "Release",
      environmentId: "env-pc",
      message: "Cut the tag",
    });
    expect(named.confirmation).toMatchObject({
      environmentId: "env-pc",
      threadId: "thread-release-b",
    });

    const summary = await service.executeTool("get_thread_summary", { threadId: "release" });
    expect(summary.status).toBe("ambiguous");
  });
});

describe("resolveThread", () => {
  const threads = [AUTH, UI, RELEASE_MAC, RELEASE_PC];

  it("prefers an exact id, then an exact title, then a partial title", () => {
    expect(resolveThread(threads, "thread-ui")).toMatchObject({ kind: "found", thread: UI });
    expect(resolveThread(threads, "polish carplay voice orb")).toMatchObject({
      kind: "found",
      thread: UI,
    });
    expect(resolveThread(threads, "oauth")).toMatchObject({ kind: "found", thread: AUTH });
    expect(resolveThread(threads, "nothing like this")).toEqual({ kind: "missing" });
  });

  it("reports the same thread id on two computers as ambiguous until the computer is given", () => {
    const twin: BridgeThreadSummary = { ...RELEASE_PC, threadId: RELEASE_MAC.threadId };
    expect(resolveThread([RELEASE_MAC, twin], RELEASE_MAC.threadId).kind).toBe("ambiguous");
    expect(resolveThread([RELEASE_MAC, twin], RELEASE_MAC.threadId, "env-pc")).toMatchObject({
      kind: "found",
      thread: twin,
    });
  });
});
