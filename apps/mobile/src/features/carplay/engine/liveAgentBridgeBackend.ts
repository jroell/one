import { enabledEnvironmentIds } from "@t3tools/client-runtime/state/connections";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  MessageId,
  type EnvironmentId,
  type ThreadId,
  type RuntimeRequestId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { msg } from "gt-react-native";

import { environmentCatalog } from "../../../connection/catalog";
import { m } from "../../../i18n/messages";
import { appAtomRegistry } from "../../../state/atom-registry";
import { readEnvironmentScope } from "../../../state/session";
import {
  environmentThreadDetails,
  environmentThreads,
  environmentThreadShells,
  threadEnvironment,
} from "../../../state/threads";
import type { AgentBridgeBackend, BridgeApprovalItem } from "./agentBridgeTools";
import { sanitizeForSpeech } from "./personas";
import type { BridgeThreadStatus, BridgeThreadSummary } from "./types";

function mapThreadStatus(input: {
  readonly hasPendingApprovals: boolean;
  readonly runtimeStatus: string | undefined;
  readonly lastError: string | null | undefined;
}): BridgeThreadStatus {
  if (input.hasPendingApprovals) return "needs_approval";
  if (input.lastError) return "error";
  if (
    input.runtimeStatus === "running" ||
    input.runtimeStatus === "starting" ||
    input.runtimeStatus === "preparing" ||
    input.runtimeStatus === "queued" ||
    input.runtimeStatus === "waiting"
  ) {
    return "running";
  }
  return "ready";
}

function statusBadgeLabel(status: BridgeThreadStatus, pendingApprovalCount: number): string {
  switch (status) {
    case "needs_approval":
      return pendingApprovalCount === 1
        ? m(msg("Needs Approval"))
        : m(msg("{count} Approvals"), { count: pendingApprovalCount });
    case "running":
      return m(msg("Running"));
    case "error":
      return m(msg("Needs Attention"));
    case "ready":
      return m(msg("Ready"));
  }
}

function summarizeApprovalKind(request: {
  readonly requestKind?: string;
  readonly detail?: string | null;
}): string {
  const detail = request.detail ? sanitizeForSpeech(request.detail).slice(0, 140) : "";
  if (detail.length > 0) return detail;
  if (request.requestKind) {
    return m(msg("Permission request for {kind}"), {
      kind: request.requestKind.replace(/_/g, " "),
    });
  }
  return m(msg("Pending agent approval request"));
}

export function createLiveAgentBridgeBackend(): AgentBridgeBackend {
  const readShells = () => {
    try {
      return appAtomRegistry.get(environmentThreadShells.navigationThreadShellsAtom);
    } catch {
      return [];
    }
  };

  const toSummary = (shell: ReturnType<typeof readShells>[number]): BridgeThreadSummary => {
    const pending = appAtomRegistry.get(
      environmentThreadDetails.pendingRequestsAtom({
        environmentId: shell.environmentId,
        threadId: shell.id,
      }),
    );
    const pendingApprovalCount = pending?.approvals.length ?? (shell.hasPendingApprovals ? 1 : 0);
    const status = mapThreadStatus({
      hasPendingApprovals: shell.hasPendingApprovals || pendingApprovalCount > 0,
      runtimeStatus: shell.runtime?.status,
      lastError: shell.runtime?.lastError,
    });
    return {
      environmentId: shell.environmentId,
      threadId: shell.id,
      title: shell.title.trim() || m(msg("Untitled thread")),
      status,
      pendingApprovalCount,
      lastActivityLabel: statusBadgeLabel(status, pendingApprovalCount),
      branch: shell.branch,
    };
  };

  return {
    isConnected() {
      try {
        const catalog = appAtomRegistry.get(environmentCatalog.catalogValueAtom);
        for (const _id of enabledEnvironmentIds(catalog)) {
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },

    listThreads() {
      const shells = readShells();
      return shells
        .filter((shell) => shell.archivedAt === null)
        .slice(0, 16)
        .map(toSummary);
    },

    getThreadDetail(threadId) {
      const shells = readShells();
      const lower = threadId.trim().toLowerCase();
      const shell =
        shells.find((entry) => entry.id === threadId) ??
        shells.find((entry) => entry.title.toLowerCase().includes(lower));
      if (!shell) return null;

      const threadSummary = toSummary(shell);
      const stateResult = appAtomRegistry.get(
        environmentThreads.stateAtom(shell.environmentId, shell.id),
      );
      const state = AsyncResult.getOrElse(stateResult, () => null);
      const projection = state ? Option.getOrNull(state.data) : null;
      const recentMessages: Array<{ readonly role: "user" | "assistant"; readonly text: string }> =
        [];

      const turnItems = projection?.turnItems ?? [];
      for (let i = Math.max(0, turnItems.length - 8); i < turnItems.length; i++) {
        const item = turnItems[i];
        if (!item) continue;
        if (item.type === "user_message" && "text" in item && typeof item.text === "string") {
          const clean = sanitizeForSpeech(item.text).slice(0, 220);
          if (clean) recentMessages.push({ role: "user", text: clean });
        } else if (
          item.type === "assistant_message" &&
          "text" in item &&
          typeof item.text === "string"
        ) {
          const clean = sanitizeForSpeech(item.text).slice(0, 260);
          if (clean) recentMessages.push({ role: "assistant", text: clean });
        }
      }

      const pendingApprovals = this.listPendingApprovals(shell.id);
      return {
        thread: threadSummary,
        recentMessages: recentMessages.slice(-4),
        pendingApprovals,
      };
    },

    listPendingApprovals(threadId) {
      const shells = readShells();
      const items: Array<BridgeApprovalItem> = [];
      for (const shell of shells) {
        if (threadId && shell.id !== threadId) continue;
        const pending = appAtomRegistry.get(
          environmentThreadDetails.pendingRequestsAtom({
            environmentId: shell.environmentId,
            threadId: shell.id,
          }),
        );
        if (!pending) continue;
        for (const approval of pending.approvals) {
          items.push({
            environmentId: shell.environmentId,
            threadId: shell.id,
            threadTitle: shell.title.trim() || m(msg("Untitled thread")),
            requestId: approval.requestId,
            summary: summarizeApprovalKind(approval),
            canRespondLive: approval.responseCapability === "live",
          });
        }
      }
      return items;
    },

    async sendMessageToThread(environmentId, threadId, message) {
      const envId = environmentId as EnvironmentId;
      const tId = threadId as ThreadId;
      if (!readEnvironmentScope(envId, AuthOrchestrationOperateScope)) {
        return {
          ok: false,
          error: m(msg("This device does not have permission to send commands to that computer.")),
        };
      }
      const shell = readShells().find((entry) => entry.environmentId === envId && entry.id === tId);
      const messageId = MessageId.make(
        `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      );
      const result = await runAtomCommand(
        appAtomRegistry,
        threadEnvironment.startTurn,
        {
          environmentId: envId,
          input: {
            threadId: tId,
            message: {
              messageId,
              role: "user",
              text: message,
              attachments: [],
            },
            runtimeMode: shell?.runtimeMode ?? DEFAULT_RUNTIME_MODE,
            interactionMode: shell?.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
            dispatchMode: "auto",
          },
        },
        { label: "carplay:send-message-to-thread", reportFailure: false, reportDefect: false },
      );
      if (result._tag === "Success") {
        return { ok: true };
      }
      return {
        ok: false,
        error: m(msg("Could not deliver the message to that thread right now.")),
      };
    },

    async respondToApproval(environmentId, threadId, requestId, decision, feedback) {
      const envId = environmentId as EnvironmentId;
      const tId = threadId as ThreadId;
      if (!readEnvironmentScope(envId, AuthOrchestrationOperateScope)) {
        return {
          ok: false,
          error: m(
            msg("This device does not have permission to respond to approvals on that computer."),
          ),
        };
      }
      const result = await runAtomCommand(
        appAtomRegistry,
        threadEnvironment.respondToApproval,
        {
          environmentId: envId,
          input: {
            threadId: tId,
            requestId: requestId as RuntimeRequestId,
            decision,
            ...(feedback ? { feedback } : {}),
          },
        },
        { label: "carplay:respond-to-approval", reportFailure: false, reportDefect: false },
      );
      if (result._tag === "Success") {
        return { ok: true };
      }
      return {
        ok: false,
        error: m(msg("Could not submit that approval decision right now.")),
      };
    },
  };
}
