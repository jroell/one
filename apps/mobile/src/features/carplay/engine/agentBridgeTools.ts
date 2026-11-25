import type { ProviderApprovalDecision } from "@t3tools/contracts";
import { msg } from "gt-react-native";

import { m } from "../../../i18n/messages";
import { sanitizeForSpeech } from "./personas";
import type {
  BridgeThreadSummary,
  PendingConfirmation,
  VoiceToolDefinition,
  VoiceToolExecutionResult,
} from "./types";

export interface BridgeApprovalItem {
  readonly environmentId: string;
  readonly threadId: string;
  readonly threadTitle: string;
  readonly requestId: string;
  readonly summary: string;
  readonly canRespondLive: boolean;
}

export interface BridgeThreadDetail {
  readonly thread: BridgeThreadSummary;
  readonly recentMessages: ReadonlyArray<{
    readonly role: "user" | "assistant";
    readonly text: string;
  }>;
  readonly pendingApprovals: ReadonlyArray<BridgeApprovalItem>;
}

export interface AgentBridgeBackend {
  isConnected(): boolean;
  listThreads(): ReadonlyArray<BridgeThreadSummary>;
  getThreadDetail(threadId: string): BridgeThreadDetail | null;
  listPendingApprovals(threadId?: string): ReadonlyArray<BridgeApprovalItem>;
  sendMessageToThread(
    environmentId: string,
    threadId: string,
    message: string,
  ): Promise<{ readonly ok: boolean; readonly error?: string }>;
  respondToApproval(
    environmentId: string,
    threadId: string,
    requestId: string,
    decision: ProviderApprovalDecision,
    feedback?: string,
  ): Promise<{ readonly ok: boolean; readonly error?: string }>;
}

export const AGENT_BRIDGE_TOOLS: ReadonlyArray<VoiceToolDefinition> = [
  {
    name: "list_active_threads",
    description:
      // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
      "Lists active One coding threads across linked computers, including status and pending approvals.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_thread_summary",
    description:
      // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
      "Returns a concise, speech-friendly summary of a specific One coding thread without raw code or diffs.",
    parameters: {
      type: "object",
      properties: {
        threadId: {
          type: "string",
          // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
          description: "The ID or partial title of the thread to summarize.",
        },
      },
      required: ["threadId"],
    },
  },
  {
    name: "list_pending_approvals",
    description:
      // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
      "Lists pending permission or command approvals waiting for the user on linked One coding threads.",
    parameters: {
      type: "object",
      properties: {
        threadId: {
          type: "string",
          // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
          description: "Optional thread ID to filter approvals.",
        },
      },
    },
  },
  {
    name: "send_message_to_thread",
    description:
      // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
      "Sends a follow-up instruction to a linked One coding thread. Must be verbally confirmed by the driver before setting confirmed to true.",
    parameters: {
      type: "object",
      properties: {
        threadId: {
          type: "string",
          // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
          description: "Target thread ID or exact title.",
        },
        message: {
          type: "string",
          // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
          description: "Instruction to send to the coding agent.",
        },
        confirmed: {
          type: "boolean",
          description:
            // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
            "Set true ONLY after asking the driver aloud and receiving explicit verbal confirmation.",
        },
        confirmationId: {
          type: "string",
          // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
          description: "The confirmationId returned from the prior confirmation check.",
        },
      },
      required: ["threadId", "message"],
    },
  },
  {
    name: "respond_to_approval",
    description:
      // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
      "Approves or declines a pending request on a linked One thread. Must be verbally confirmed by the driver before setting confirmed to true.",
    parameters: {
      type: "object",
      properties: {
        threadId: {
          type: "string",
          // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
          description: "Target thread ID.",
        },
        requestId: {
          type: "string",
          // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
          description: "The pending approval request ID.",
        },
        decision: {
          type: "string",
          // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
          description: "Approval decision.",
          enum: ["accept", "acceptForSession", "decline", "cancel"],
        },
        feedback: {
          type: "string",
          // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
          description: "Optional short spoken reason when declining.",
        },
        confirmed: {
          type: "boolean",
          description:
            // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
            "Set true ONLY after asking the driver aloud and receiving explicit verbal confirmation.",
        },
        confirmationId: {
          type: "string",
          // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
          description: "The confirmationId returned from the prior confirmation check.",
        },
      },
      required: ["threadId", "requestId", "decision"],
    },
  },
];

const CONFIRMATION_TTL_MS = 90_000;
const ALLOWED_APPROVAL_DECISIONS = new Set<ProviderApprovalDecision>([
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
]);

export class AgentBridgeService {
  readonly #backend: AgentBridgeBackend;
  readonly #now: () => number;
  #pendingConfirmation: PendingConfirmation | null = null;
  #confirmationSeq = 0;

  constructor(backend: AgentBridgeBackend, now: () => number = () => Date.now()) {
    this.#backend = backend;
    this.#now = now;
  }

  getPendingConfirmation(): PendingConfirmation | null {
    if (this.#pendingConfirmation && this.#pendingConfirmation.expiresAt <= this.#now()) {
      this.#pendingConfirmation = null;
    }
    return this.#pendingConfirmation;
  }

  clearPendingConfirmation(): void {
    this.#pendingConfirmation = null;
  }

  listThreads(): ReadonlyArray<BridgeThreadSummary> {
    if (!this.#backend.isConnected()) return [];
    return this.#backend.listThreads();
  }

  async confirmPendingAction(): Promise<VoiceToolExecutionResult> {
    const pending = this.getPendingConfirmation();
    if (!pending) {
      return {
        ok: false,
        status: "error",
        spokenSummary: "There is no pending action waiting for confirmation.",
      };
    }
    return this.executeTool(pending.toolName, {
      ...pending.payload,
      confirmed: true,
      confirmationId: pending.id,
    });
  }

  async executeTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<VoiceToolExecutionResult> {
    if (!this.#backend.isConnected()) {
      return {
        ok: true,
        status: "disconnected",
        spokenSummary:
          "No computer is linked to One right now, so I cannot inspect your coding threads. We can keep chatting about anything else.",
        data: { connected: false, threads: [] },
      };
    }

    switch (name) {
      case "list_active_threads": {
        const threads = this.#backend.listThreads();
        if (threads.length === 0) {
          return {
            ok: true,
            status: "completed",
            spokenSummary: "Your computer is connected, and there are no active threads right now.",
            data: { connected: true, threads: [] },
          };
        }
        const approvalCount = threads.reduce((sum, item) => sum + item.pendingApprovalCount, 0);
        const runningCount = threads.filter((item) => item.status === "running").length;
        const highlights = threads
          .slice(0, 4)
          .map((item) => `${item.title} (${item.lastActivityLabel})`)
          .join(", ");
        const spokenSummary = `You have ${threads.length} active threads. ${runningCount} running, ${approvalCount} waiting for approval. Top threads: ${highlights}.`;
        return {
          ok: true,
          status: "completed",
          spokenSummary,
          data: { connected: true, threads },
        };
      }

      case "get_thread_summary": {
        const threadId = typeof args.threadId === "string" ? args.threadId : "";
        if (!threadId.trim()) {
          return {
            ok: false,
            status: "error",
            spokenSummary: "Tell me which thread you want me to summarize.",
          };
        }
        const detail = this.#backend.getThreadDetail(threadId);
        if (!detail) {
          return {
            ok: false,
            status: "error",
            spokenSummary: `I could not find a thread matching ${sanitizeForSpeech(threadId)}.`,
          };
        }
        const lastAssistant = [...detail.recentMessages]
          .reverse()
          .find((entry) => entry.role === "assistant");
        const approvalNote =
          detail.pendingApprovals.length > 0
            ? ` It has ${detail.pendingApprovals.length} pending approval waiting: ${detail.pendingApprovals[0]!.summary}.`
            : "";
        const updateNote = lastAssistant
          ? ` Latest update: ${lastAssistant.text}`
          : " There are no recent assistant replies yet.";
        return {
          ok: true,
          status: "completed",
          spokenSummary: `Thread ${detail.thread.title} is ${detail.thread.lastActivityLabel.toLowerCase()}.${approvalNote}${updateNote}`,
          data: detail,
        };
      }

      case "list_pending_approvals": {
        const threadId = typeof args.threadId === "string" ? args.threadId : undefined;
        const approvals = this.#backend.listPendingApprovals(threadId);
        if (approvals.length === 0) {
          return {
            ok: true,
            status: "completed",
            spokenSummary: "There are no pending approvals right now.",
            data: { approvals: [] },
          };
        }
        const first = approvals[0]!;
        const spokenSummary =
          approvals.length === 1
            ? `One approval is waiting on ${first.threadTitle}: ${first.summary}.`
            : `${approvals.length} approvals are waiting. The first is on ${first.threadTitle}: ${first.summary}.`;
        return {
          ok: true,
          status: "completed",
          spokenSummary,
          data: { approvals },
        };
      }

      case "send_message_to_thread": {
        return this.#handleSendMessage(args);
      }

      case "respond_to_approval": {
        return this.#handleRespondToApproval(args);
      }

      default:
        return {
          ok: false,
          status: "error",
          spokenSummary: `Unknown Agent Bridge tool ${name}.`,
        };
    }
  }

  async #handleSendMessage(
    args: Readonly<Record<string, unknown>>,
  ): Promise<VoiceToolExecutionResult> {
    const threadId = typeof args.threadId === "string" ? args.threadId.trim() : "";
    const message = typeof args.message === "string" ? args.message.trim() : "";
    if (!threadId || !message) {
      return {
        ok: false,
        status: "error",
        spokenSummary: "I need both the thread and the message you want to send.",
      };
    }

    const detail = this.#backend.getThreadDetail(threadId);
    if (!detail) {
      return {
        ok: false,
        status: "error",
        spokenSummary: `I could not find a thread matching ${sanitizeForSpeech(threadId)}.`,
      };
    }

    const confirmed = args.confirmed === true;
    const confirmationId = typeof args.confirmationId === "string" ? args.confirmationId : "";
    const activeConfirmation = this.getPendingConfirmation();
    const matchesPending =
      confirmed &&
      activeConfirmation !== null &&
      activeConfirmation.toolName === "send_message_to_thread" &&
      activeConfirmation.payload.threadId === detail.thread.threadId &&
      activeConfirmation.payload.message === message &&
      (confirmationId === "" || confirmationId === activeConfirmation.id);

    if (!matchesPending) {
      const cleanSnippet = sanitizeForSpeech(message).slice(0, 120);
      const confirmation: PendingConfirmation = {
        id: `confirm-${++this.#confirmationSeq}`,
        toolName: "send_message_to_thread",
        summary: m(msg('Send "{message}" to {thread}'), {
          message: cleanSnippet,
          thread: detail.thread.title,
        }),
        expiresAt: this.#now() + CONFIRMATION_TTL_MS,
        payload: {
          threadId: detail.thread.threadId,
          message,
        },
      };
      this.#pendingConfirmation = confirmation;
      return {
        ok: true,
        status: "needs_confirmation",
        spokenSummary: `Please confirm: should I send this message to ${detail.thread.title}? "${cleanSnippet}"`,
        confirmation,
        data: { confirmationId: confirmation.id, requiresVerbalConfirmation: true },
      };
    }

    this.#pendingConfirmation = null;
    const result = await this.#backend.sendMessageToThread(
      detail.thread.environmentId,
      detail.thread.threadId,
      message,
    );
    if (!result.ok) {
      return {
        ok: false,
        status: "error",
        spokenSummary: result.error ?? "Failed to send message to the thread.",
      };
    }
    return {
      ok: true,
      status: "completed",
      spokenSummary: `Sent your instructions to ${detail.thread.title}.`,
      data: { threadId: detail.thread.threadId, sent: true },
    };
  }

  async #handleRespondToApproval(
    args: Readonly<Record<string, unknown>>,
  ): Promise<VoiceToolExecutionResult> {
    const threadId = typeof args.threadId === "string" ? args.threadId.trim() : "";
    const requestId = typeof args.requestId === "string" ? args.requestId.trim() : "";
    const decisionRaw = typeof args.decision === "string" ? args.decision.trim() : "";
    const feedback = typeof args.feedback === "string" ? args.feedback.trim() : undefined;

    if (
      !threadId ||
      !requestId ||
      !ALLOWED_APPROVAL_DECISIONS.has(decisionRaw as ProviderApprovalDecision)
    ) {
      return {
        ok: false,
        status: "error",
        spokenSummary: "I need the thread, approval request, and whether to approve or decline.",
      };
    }

    const decision = decisionRaw as ProviderApprovalDecision;
    const approvals = this.#backend.listPendingApprovals(threadId);
    const approval = approvals.find((item) => item.requestId === requestId);
    if (!approval) {
      return {
        ok: false,
        status: "error",
        spokenSummary: "That approval request is no longer pending.",
      };
    }
    if (!approval.canRespondLive) {
      return {
        ok: false,
        status: "error",
        spokenSummary: "That approval cannot be answered live from mobile right now.",
      };
    }

    const confirmed = args.confirmed === true;
    const confirmationId = typeof args.confirmationId === "string" ? args.confirmationId : "";
    const activeConfirmation = this.getPendingConfirmation();
    const matchesPending =
      confirmed &&
      activeConfirmation !== null &&
      activeConfirmation.toolName === "respond_to_approval" &&
      activeConfirmation.payload.threadId === approval.threadId &&
      activeConfirmation.payload.requestId === approval.requestId &&
      activeConfirmation.payload.decision === decision &&
      (activeConfirmation.payload.feedback ?? undefined) === feedback &&
      (confirmationId === "" || confirmationId === activeConfirmation.id);

    const isApprove = decision === "accept" || decision === "acceptForSession";

    if (!matchesPending) {
      const confirmation: PendingConfirmation = {
        id: `confirm-${++this.#confirmationSeq}`,
        toolName: "respond_to_approval",
        summary: isApprove
          ? m(msg('Approve "{summary}" on {thread}'), {
              summary: approval.summary,
              thread: approval.threadTitle,
            })
          : m(msg('Decline "{summary}" on {thread}'), {
              summary: approval.summary,
              thread: approval.threadTitle,
            }),
        expiresAt: this.#now() + CONFIRMATION_TTL_MS,
        payload: {
          threadId: approval.threadId,
          requestId: approval.requestId,
          decision,
          ...(feedback ? { feedback } : {}),
        },
      };
      this.#pendingConfirmation = confirmation;
      return {
        ok: true,
        status: "needs_confirmation",
        spokenSummary: `Please confirm: should I ${isApprove ? "approve" : "decline"} ${approval.summary} on ${approval.threadTitle}?`,
        confirmation,
        data: { confirmationId: confirmation.id, requiresVerbalConfirmation: true },
      };
    }

    this.#pendingConfirmation = null;
    const result = await this.#backend.respondToApproval(
      approval.environmentId,
      approval.threadId,
      approval.requestId,
      decision,
      feedback,
    );
    if (!result.ok) {
      return {
        ok: false,
        status: "error",
        spokenSummary: result.error ?? "Failed to submit that approval decision.",
      };
    }
    return {
      ok: true,
      status: "completed",
      spokenSummary: isApprove
        ? `Approved the request on ${approval.threadTitle}.`
        : `Declined the request on ${approval.threadTitle}.`,
      data: { threadId: approval.threadId, requestId: approval.requestId, decision },
    };
  }
}
