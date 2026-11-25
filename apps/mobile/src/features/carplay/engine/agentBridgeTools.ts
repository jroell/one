import { msg } from "gt-react-native";

import { m } from "../../../i18n/messages";
import { sanitizeForSpeech } from "./personas";
import type {
  BridgeThreadRef,
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
}

export interface BridgeThreadDetail {
  readonly thread: BridgeThreadSummary;
  readonly recentMessages: ReadonlyArray<{
    readonly role: "user" | "assistant";
    readonly text: string;
  }>;
  readonly pendingApprovals: ReadonlyArray<BridgeApprovalItem>;
}

/**
 * Drive reads workspace state and can propose one kind of change, a follow-up message. Answering an
 * approval request is deliberately not part of this interface: approvals are decided in the One app.
 */
export interface AgentBridgeBackend {
  isConnected(): boolean;
  /** Threads for the dashboard and spoken lists; may be capped. */
  listThreads(): ReadonlyArray<BridgeThreadSummary>;
  /** Every active thread, so a spoken title can be checked for duplicates. */
  listThreadsForLookup(): ReadonlyArray<BridgeThreadSummary>;
  getThreadDetail(ref: BridgeThreadRef): BridgeThreadDetail | null;
  listPendingApprovals(ref?: BridgeThreadRef): ReadonlyArray<BridgeApprovalItem>;
  sendMessageToThread(
    ref: BridgeThreadRef,
    message: string,
  ): Promise<{ readonly ok: boolean; readonly error?: string }>;
}

type ThreadResolution =
  | { readonly kind: "found"; readonly thread: BridgeThreadSummary }
  | { readonly kind: "ambiguous"; readonly matches: ReadonlyArray<BridgeThreadSummary> }
  | { readonly kind: "missing" };

/**
 * Matches a spoken or model-supplied reference to one thread. An exact id wins, then an exact title,
 * then a partial title. Several matches at the same level are never resolved by picking the first.
 */
export function resolveThread(
  threads: ReadonlyArray<BridgeThreadSummary>,
  query: string,
  environmentId?: string,
): ThreadResolution {
  const needle = query.trim().toLowerCase();
  if (!needle) return { kind: "missing" };
  const scoped = environmentId
    ? threads.filter((thread) => thread.environmentId === environmentId)
    : threads;
  const tiers: ReadonlyArray<(thread: BridgeThreadSummary) => boolean> = [
    (thread) => thread.threadId.toLowerCase() === needle,
    (thread) => thread.title.trim().toLowerCase() === needle,
    (thread) => thread.title.toLowerCase().includes(needle),
  ];
  for (const matches of tiers) {
    const hits = scoped.filter(matches);
    if (hits.length === 1) return { kind: "found", thread: hits[0]! };
    if (hits.length > 1) return { kind: "ambiguous", matches: hits };
  }
  return { kind: "missing" };
}

/** One key for a thread across computers; CarPlay echoes it back when the driver picks a thread. */
export function bridgeThreadKey(ref: BridgeThreadRef): string {
  return `${ref.environmentId}::${ref.threadId}`;
}

const APPROVALS_NOT_IN_DRIVE_MESSAGE =
  "Approvals are not handled by voice. Answer them in the One app when you are parked.";

/** Longest follow-up message Drive will propose, so the whole text can be read back and shown. */
export const MAX_PROPOSAL_MESSAGE_CHARS = 400;

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
      "Returns a concise, speech-friendly summary of a specific One coding thread without raw code or diffs. If several threads match the title, the result says so: ask the driver which one.",
    parameters: {
      type: "object",
      properties: {
        threadId: {
          type: "string",
          // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
          description: "The ID or title of the thread to summarize.",
        },
        environmentId: {
          type: "string",
          // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
          description: "Optional computer ID from list_active_threads, to tell apart equal titles.",
        },
      },
      required: ["threadId"],
    },
  },
  {
    name: "list_pending_approvals",
    description:
      // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
      "Lists pending permission or command approvals waiting for the user on linked One coding threads. Read-only: approvals cannot be answered by voice.",
    parameters: {
      type: "object",
      properties: {
        threadId: {
          type: "string",
          // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
          description: "Optional thread ID or title to filter approvals.",
        },
        environmentId: {
          type: "string",
          // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
          description: "Optional computer ID from list_active_threads.",
        },
      },
    },
  },
  {
    name: "send_message_to_thread",
    description:
      // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
      `Proposes a follow-up instruction for a linked One coding thread. Nothing is sent by this call: the driver must tap Send on the phone screen. Read the whole message back aloud and tell the driver to tap Send. Messages over ${MAX_PROPOSAL_MESSAGE_CHARS} characters are refused. A new proposal replaces the previous one.`,
    parameters: {
      type: "object",
      properties: {
        threadId: {
          type: "string",
          // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
          description: "Target thread ID or title.",
        },
        environmentId: {
          type: "string",
          // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
          description: "Optional computer ID from list_active_threads, to tell apart equal titles.",
        },
        message: {
          type: "string",
          // oxlint-disable-next-line t3code/no-untranslated-copy -- tool schema description sent to the voice model
          description: "Instruction to send to the coding agent, exactly as it should be sent.",
        },
      },
      required: ["threadId", "message"],
    },
  },
];

const CONFIRMATION_TTL_MS = 90_000;

function readString(args: Readonly<Record<string, unknown>>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function ambiguousResult(query: string, matches: ReadonlyArray<BridgeThreadSummary>) {
  const names = matches
    .slice(0, 4)
    .map((item) => item.title)
    .join("; ");
  return {
    ok: false,
    status: "ambiguous" as const,
    spokenSummary: `More than one thread matches ${sanitizeForSpeech(query)}: ${sanitizeForSpeech(names)}. Ask the driver which one they mean.`,
    data: {
      matches: matches.map((item) => ({
        environmentId: item.environmentId,
        threadId: item.threadId,
        title: item.title,
      })),
    },
  };
}

function missingResult(query: string) {
  return {
    ok: false,
    status: "error" as const,
    spokenSummary: `I could not find a thread matching ${sanitizeForSpeech(query)}.`,
  };
}

export class AgentBridgeService {
  readonly #backend: AgentBridgeBackend;
  readonly #now: () => number;
  #pendingConfirmation: PendingConfirmation | null = null;
  #confirmationSeq = 0;

  constructor(backend: AgentBridgeBackend, now: () => number = () => Date.now()) {
    this.#backend = backend;
    this.#now = now;
  }

  /** The current proposal, or null once it has expired. An expired proposal is dropped here. */
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

  /**
   * Runs the proposal the driver tapped. `proposalId` must be the id the screen showed: a replaced,
   * expired or already used proposal sends nothing. This is the only path that sends a message and
   * `executeTool` cannot reach it.
   */
  async confirmProposal(proposalId: string): Promise<VoiceToolExecutionResult> {
    const pending = this.getPendingConfirmation();
    if (!pending || pending.id !== proposalId) {
      return {
        ok: false,
        status: "error",
        spokenSummary: m(msg("That message is no longer waiting, so nothing was sent.")),
      };
    }
    // Clear before sending so a second tap during the send cannot send it twice.
    this.#pendingConfirmation = null;
    const result = await this.#backend.sendMessageToThread(
      { environmentId: pending.environmentId, threadId: pending.threadId },
      pending.message,
    );
    if (!result.ok) {
      return {
        ok: false,
        status: "error",
        spokenSummary: result.error ?? m(msg("Could not send the message to that thread.")),
      };
    }
    return {
      ok: true,
      status: "completed",
      spokenSummary: m(msg("Sent your message to {thread}."), { thread: pending.threadTitle }),
      data: { environmentId: pending.environmentId, threadId: pending.threadId, sent: true },
    };
  }

  /** Drops the proposal the driver cancelled; a different proposal that replaced it stays. */
  dismissProposal(proposalId: string): boolean {
    const pending = this.getPendingConfirmation();
    if (!pending || pending.id !== proposalId) return false;
    this.#pendingConfirmation = null;
    return true;
  }

  async executeTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<VoiceToolExecutionResult> {
    if (name === "respond_to_approval") {
      return { ok: false, status: "error", spokenSummary: APPROVALS_NOT_IN_DRIVE_MESSAGE };
    }
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
        const query = readString(args, "threadId");
        if (!query) {
          return {
            ok: false,
            status: "error",
            spokenSummary: "Tell me which thread you want me to summarize.",
          };
        }
        const resolved = resolveThread(
          this.#backend.listThreadsForLookup(),
          query,
          readString(args, "environmentId") || undefined,
        );
        if (resolved.kind === "ambiguous") return ambiguousResult(query, resolved.matches);
        if (resolved.kind === "missing") return missingResult(query);
        const detail = this.#backend.getThreadDetail(resolved.thread);
        if (!detail) return missingResult(query);
        const lastAssistant = [...detail.recentMessages]
          .reverse()
          .find((entry) => entry.role === "assistant");
        const approvalNote =
          detail.pendingApprovals.length > 0
            ? ` It has ${detail.pendingApprovals.length} pending approval waiting: ${detail.pendingApprovals[0]!.summary}. Approvals are answered in the One app when parked.`
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
        const query = readString(args, "threadId");
        let ref: BridgeThreadRef | undefined;
        if (query) {
          const resolved = resolveThread(
            this.#backend.listThreadsForLookup(),
            query,
            readString(args, "environmentId") || undefined,
          );
          if (resolved.kind === "ambiguous") return ambiguousResult(query, resolved.matches);
          if (resolved.kind === "missing") return missingResult(query);
          ref = resolved.thread;
        }
        const approvals = this.#backend.listPendingApprovals(ref);
        if (approvals.length === 0) {
          return {
            ok: true,
            status: "completed",
            spokenSummary: "There are no pending approvals right now.",
            data: { approvals: [] },
          };
        }
        const first = approvals[0]!;
        const lead =
          approvals.length === 1
            ? `One approval is waiting on ${first.threadTitle}: ${first.summary}.`
            : `${approvals.length} approvals are waiting. The first is on ${first.threadTitle}: ${first.summary}.`;
        return {
          ok: true,
          status: "completed",
          spokenSummary: `${lead} Approvals are answered in the One app when you are parked.`,
          data: {
            approvals: approvals.map((item) => ({
              environmentId: item.environmentId,
              threadId: item.threadId,
              threadTitle: item.threadTitle,
              summary: item.summary,
            })),
          },
        };
      }

      case "send_message_to_thread":
        return this.#proposeMessage(args);

      default:
        return {
          ok: false,
          status: "error",
          spokenSummary: `Unknown Agent Bridge tool ${name}.`,
        };
    }
  }

  /** Records a proposal. Whatever arguments the model sends, this never sends the message. */
  #proposeMessage(args: Readonly<Record<string, unknown>>): VoiceToolExecutionResult {
    const query = readString(args, "threadId");
    const message = readString(args, "message");
    if (!query || !message) {
      return {
        ok: false,
        status: "error",
        spokenSummary: "I need both the thread and the message you want to send.",
      };
    }
    if (message.length > MAX_PROPOSAL_MESSAGE_CHARS) {
      return {
        ok: false,
        status: "error",
        spokenSummary: `That message is ${message.length} characters, over the ${MAX_PROPOSAL_MESSAGE_CHARS} character limit for sending from the car, because it has to be read back and shown whole. Shorten it, or send it from the One app when you are parked.`,
        data: { maxCharacters: MAX_PROPOSAL_MESSAGE_CHARS, length: message.length },
      };
    }

    const resolved = resolveThread(
      this.#backend.listThreadsForLookup(),
      query,
      readString(args, "environmentId") || undefined,
    );
    if (resolved.kind === "ambiguous") return ambiguousResult(query, resolved.matches);
    if (resolved.kind === "missing") return missingResult(query);
    const thread = resolved.thread;

    const replaced = this.getPendingConfirmation();
    const confirmation: PendingConfirmation = Object.freeze({
      id: `confirm-${++this.#confirmationSeq}`,
      toolName: "send_message_to_thread",
      summary: m(msg('Send "{message}" to {thread}'), { message, thread: thread.title }),
      environmentId: thread.environmentId,
      threadId: thread.threadId,
      threadTitle: thread.title,
      message,
      expiresAt: this.#now() + CONFIRMATION_TTL_MS,
    });
    this.#pendingConfirmation = confirmation;
    const replacedNote = replaced
      ? " This replaces the message that was waiting before; that one will not be sent."
      : "";
    return {
      ok: true,
      status: "needs_confirmation",
      spokenSummary: `Nothing is sent yet. The message for ${sanitizeForSpeech(thread.title)} is: "${message}". Read it back to the driver and ask them to tap Send on the phone screen.${replacedNote}`,
      confirmation,
      data: {
        proposalId: confirmation.id,
        sent: false,
        confirmOnPhoneScreen: true,
        expiresInSeconds: CONFIRMATION_TTL_MS / 1000,
        replacedProposalId: replaced?.id ?? null,
      },
    };
  }
}
