import { describe, expect, it, vi } from "vite-plus/test";

import { AgentBridgeService, type AgentBridgeBackend } from "./agentBridgeTools";

function createFakeBackend(options: { readonly connected?: boolean } = {}): AgentBridgeBackend {
  const connected = options.connected ?? true;
  return {
    isConnected: () => connected,
    listThreads: () =>
      connected
        ? [
            {
              environmentId: "env-mac",
              threadId: "thread-auth",
              title: "Refactor OAuth retry queue",
              status: "needs_approval",
              pendingApprovalCount: 1,
              lastActivityLabel: "Needs Approval",
              branch: "fix/oauth-retry",
            },
            {
              environmentId: "env-mac",
              threadId: "thread-ui",
              title: "Polish CarPlay voice orb",
              status: "running",
              pendingApprovalCount: 0,
              lastActivityLabel: "Running",
              branch: "feat/carplay",
            },
          ]
        : [],
    getThreadDetail: (threadId) => {
      if (!connected) return null;
      if (threadId === "thread-auth" || threadId.toLowerCase().includes("oauth")) {
        return {
          thread: {
            environmentId: "env-mac",
            threadId: "thread-auth",
            title: "Refactor OAuth retry queue",
            status: "needs_approval",
            pendingApprovalCount: 1,
            lastActivityLabel: "Needs Approval",
          },
          recentMessages: [
            { role: "assistant", text: "Tests passed after adding exponential backoff." },
          ],
          pendingApprovals: [
            {
              environmentId: "env-mac",
              threadId: "thread-auth",
              threadTitle: "Refactor OAuth retry queue",
              requestId: "req-101",
              summary: "Run pnpm test in apps/server",
              canRespondLive: true,
            },
          ],
        };
      }
      return null;
    },
    listPendingApprovals: (threadId) => {
      if (!connected) return [];
      const all = [
        {
          environmentId: "env-mac",
          threadId: "thread-auth",
          threadTitle: "Refactor OAuth retry queue",
          requestId: "req-101",
          summary: "Run pnpm test in apps/server",
          canRespondLive: true,
        },
      ];
      return threadId ? all.filter((item) => item.threadId === threadId) : all;
    },
    sendMessageToThread: vi.fn(async () => ({ ok: true })),
    respondToApproval: vi.fn(async () => ({ ok: true })),
  };
}

describe("AgentBridgeService", () => {
  it("falls back gracefully when no One computer is connected", async () => {
    const service = new AgentBridgeService(createFakeBackend({ connected: false }));
    const result = await service.executeTool("list_active_threads", {});
    expect(result.ok).toBe(true);
    expect(result.status).toBe("disconnected");
    expect(result.spokenSummary).toContain("No computer is linked");
  });

  it("summarizes threads and pending approvals in plain spoken English", async () => {
    const service = new AgentBridgeService(createFakeBackend());

    const listResult = await service.executeTool("list_active_threads", {});
    expect(listResult.status).toBe("completed");
    expect(listResult.spokenSummary).toContain("2 active threads");
    expect(listResult.spokenSummary).toContain("Refactor OAuth retry queue");

    const summaryResult = await service.executeTool("get_thread_summary", {
      threadId: "oauth",
    });
    expect(summaryResult.status).toBe("completed");
    expect(summaryResult.spokenSummary).toContain("Tests passed after adding exponential backoff");
    expect(summaryResult.spokenSummary).toContain("Run pnpm test in apps/server");
  });

  it("blocks send_message_to_thread until driver verbally confirms", async () => {
    let clock = 1_000;
    const backend = createFakeBackend();
    const service = new AgentBridgeService(backend, () => clock);

    // Even if model tries passing confirmed: true without a prior confirmation prompt, block it!
    const firstAttempt = await service.executeTool("send_message_to_thread", {
      threadId: "thread-auth",
      message: "Also add a unit test for 429 responses",
      confirmed: true,
    });
    expect(firstAttempt.status).toBe("needs_confirmation");
    expect(firstAttempt.confirmation).toBeDefined();
    expect(backend.sendMessageToThread).not.toHaveBeenCalled();

    // Mismatched message payload with confirmed: true must be blocked and re-gated
    const tamperedAttempt = await service.executeTool("send_message_to_thread", {
      threadId: "thread-auth",
      message: "Force push straight to main",
      confirmed: true,
      confirmationId: firstAttempt.confirmation!.id,
    });
    expect(tamperedAttempt.status).toBe("needs_confirmation");
    expect(tamperedAttempt.confirmation?.id).not.toBe(firstAttempt.confirmation!.id);
    expect(backend.sendMessageToThread).not.toHaveBeenCalled();

    // Re-request original action, then confirm with exact matching payload
    const originalPending = await service.executeTool("send_message_to_thread", {
      threadId: "thread-auth",
      message: "Also add a unit test for 429 responses",
    });
    expect(originalPending.status).toBe("needs_confirmation");

    const confirmedAttempt = await service.executeTool("send_message_to_thread", {
      threadId: "thread-auth",
      message: "Also add a unit test for 429 responses",
      confirmed: true,
      confirmationId: originalPending.confirmation!.id,
    });
    expect(confirmedAttempt.status).toBe("completed");
    expect(backend.sendMessageToThread).toHaveBeenCalledWith(
      "env-mac",
      "thread-auth",
      "Also add a unit test for 429 responses",
    );

    // Expired confirmation should not execute
    const secondAttempt = await service.executeTool("send_message_to_thread", {
      threadId: "thread-auth",
      message: "Ship it",
    });
    expect(secondAttempt.status).toBe("needs_confirmation");
    clock += 120_000;
    expect(service.getPendingConfirmation()).toBeNull();
  });

  it("requires confirmation before responding to approvals and supports confirmPendingAction", async () => {
    const backend = createFakeBackend();
    const service = new AgentBridgeService(backend, () => 5_000);

    const gated = await service.executeTool("respond_to_approval", {
      threadId: "thread-auth",
      requestId: "req-101",
      decision: "accept",
    });
    expect(gated.status).toBe("needs_confirmation");
    expect(backend.respondToApproval).not.toHaveBeenCalled();

    // Switching decision on a confirmed call must be blocked and re-gated
    const tamperedDecision = await service.executeTool("respond_to_approval", {
      threadId: "thread-auth",
      requestId: "req-101",
      decision: "acceptForSession",
      confirmed: true,
      confirmationId: gated.confirmation!.id,
    });
    expect(tamperedDecision.status).toBe("needs_confirmation");
    expect(backend.respondToApproval).not.toHaveBeenCalled();

    // Re-gate single accept, then confirm via confirmPendingAction
    const acceptAgain = await service.executeTool("respond_to_approval", {
      threadId: "thread-auth",
      requestId: "req-101",
      decision: "accept",
    });
    expect(acceptAgain.status).toBe("needs_confirmation");

    const executed = await service.confirmPendingAction();
    expect(executed.status).toBe("completed");
    expect(backend.respondToApproval).toHaveBeenCalledWith(
      "env-mac",
      "thread-auth",
      "req-101",
      "accept",
      undefined,
    );
    expect(service.getPendingConfirmation()).toBeNull();
  });
});
