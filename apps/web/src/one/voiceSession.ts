import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

/**
 * A spoken conversation, one turn at a time:
 * listening -> sending -> thinking -> speaking -> listening ...
 */
export type VoiceStage = "off" | "listening" | "sending" | "thinking" | "speaking";

/** A message of the conversation, as voice chat sees it. */
export type VoiceMessage = Readonly<{
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  streaming: boolean;
  /** Narration the agent sent mid-turn, apart from its answer. */
  commentary?: boolean;
  /** The run this message belongs to; a steer shares the run it redirects. Absent in a draft. */
  runId?: string | null;
  /** The id the composer gave a user message when it sent it. Where absent, `id` is that id. */
  messageId?: string;
  /** The person redirected a run that was already going, so this is not a new question. */
  steer?: boolean;
}>;

/** Where the conversation stood when a question was sent. The answer is whatever follows. */
export type ReplyAnchor = Readonly<{ afterId: string | null; count: number }>;

/** The reply being read aloud. Fixed when reading begins, so later messages cannot replace it. */
export type SpokenReply = Readonly<{
  id: string;
  text: string;
  runId?: string | null;
  /** A message from voice chat itself (the connection dropped), not an answer from the thread. */
  kind?: "notice";
}>;

export type VoiceSessionState = Readonly<{
  stage: VoiceStage;
  /** The thread (or draft) this conversation belongs to. Voice chat never follows you to another thread. */
  threadKey: string | null;
  /** Started in an unsent draft, whose key changes once when its first message is sent. */
  startedAsDraft: boolean;
  /** The conversation as it stood when the current question was sent; only what follows can be its answer. */
  sentAfter: ReplyAnchor | null;
  /** The send in flight, so only the composer call that carries it can name the question's id. */
  submission: string | null;
  /** The id the composer gave the sent question, so its row can be told from another client's prompt. */
  messageId: string | null;
  /** The reply being read aloud. */
  reply: SpokenReply | null;
  /** Replies and runs already read in this conversation; none is read twice. */
  readIds: ReadonlyArray<string>;
  readRuns: ReadonlyArray<string>;
  /** What the microphone had heard when the question was sent; shown until the thread has its own row. */
  heard: string;
  /** Why the last turn could not be sent, shown with a way to try again. */
  error: string | null;
  /** The person muted the microphone: voice chat keeps its place but does not listen. */
  muted: boolean;
}>;

export type VoiceSessionEvent =
  | { readonly type: "start"; readonly threadKey: string; readonly isDraft?: boolean }
  /** The draft this conversation started in became a saved thread when its first question was sent. */
  | { readonly type: "promoted"; readonly threadKey: string }
  | { readonly type: "stop" }
  | {
      readonly type: "sent";
      readonly after: ReplyAnchor;
      readonly submission: string;
      readonly heard?: string;
    }
  /** The composer is sending `submission`'s question to the thread under this id. */
  | { readonly type: "identified"; readonly submission: string; readonly messageId: string }
  | { readonly type: "working" }
  /** The turn is over. `reply` is its finished answer, or null when it ended with nothing to read. */
  | { readonly type: "replied"; readonly reply: SpokenReply | null }
  /** Reading ended. With `replyId`, only the reply that was being read can end it. */
  | { readonly type: "spoken"; readonly replyId?: string }
  /** The question could not be sent or ran into a limit. With `submission`, only that send can fail it. */
  | { readonly type: "failed"; readonly message?: string; readonly submission?: string }
  /** The thread now shows the question's own text; it replaces what the microphone had heard. */
  | { readonly type: "asked"; readonly text: string }
  /** The person asked to try the microphone again. */
  | { readonly type: "retried" }
  /** The person turned the microphone off or back on; it holds across turns until changed. */
  | { readonly type: "muted"; readonly muted: boolean };

export const VOICE_SESSION_OFF: VoiceSessionState = {
  stage: "off",
  threadKey: null,
  startedAsDraft: false,
  sentAfter: null,
  submission: null,
  messageId: null,
  reply: null,
  readIds: [],
  readRuns: [],
  heard: "",
  error: null,
  muted: false,
};

export function reduceVoiceSession(
  state: VoiceSessionState,
  event: VoiceSessionEvent,
): VoiceSessionState {
  switch (event.type) {
    case "start":
      return state.stage === "off"
        ? {
            ...VOICE_SESSION_OFF,
            stage: "listening",
            threadKey: event.threadKey,
            startedAsDraft: event.isDraft === true,
          }
        : state;
    case "promoted":
      // Only a draft that has sent its question can turn into a thread.
      return state.startedAsDraft && state.stage !== "off" && state.stage !== "listening"
        ? { ...state, threadKey: event.threadKey, startedAsDraft: false }
        : state;
    case "stop":
      return VOICE_SESSION_OFF;
    case "sent":
      return state.stage === "listening"
        ? {
            ...state,
            stage: "sending",
            sentAfter: event.after,
            submission: event.submission,
            messageId: null,
            reply: null,
            heard: event.heard ?? "",
            error: null,
          }
        : state;
    case "identified":
      return (state.stage === "sending" || state.stage === "thinking") &&
        state.submission === event.submission &&
        state.messageId === null
        ? { ...state, messageId: event.messageId }
        : state;
    case "working":
      return state.stage === "sending" ? { ...state, stage: "thinking" } : state;
    case "replied":
      // A reply can be seen finished before any frame showed the thread working.
      if (state.stage === "thinking") {
        // A turn that ends with nothing to read goes straight back to listening.
        return event.reply === null
          ? {
              ...state,
              stage: "listening",
              sentAfter: null,
              submission: null,
              messageId: null,
              reply: null,
            }
          : { ...state, stage: "speaking", reply: event.reply, ...markRead(state, event.reply) };
      }
      return state.stage === "sending" && event.reply !== null
        ? { ...state, stage: "speaking", reply: event.reply, ...markRead(state, event.reply) }
        : state;
    case "spoken":
      if (state.stage !== "speaking") return state;
      // A late end event of an earlier reading must not finish this one.
      if (event.replyId !== undefined && event.replyId !== state.reply?.id) return state;
      return {
        ...state,
        stage: "listening",
        sentAfter: null,
        submission: null,
        messageId: null,
        reply: null,
      };
    case "failed":
      // Nothing was heard or the send was refused: listen again rather than hang.
      if (event.submission !== undefined && event.submission !== state.submission) return state;
      return state.stage === "sending" || state.stage === "thinking"
        ? {
            ...state,
            stage: "listening",
            sentAfter: null,
            submission: null,
            messageId: null,
            error: event.message ?? null,
          }
        : state;
    case "asked":
      return (state.stage === "sending" || state.stage === "thinking") && state.heard !== event.text
        ? { ...state, heard: event.text }
        : state;
    case "retried":
      return state.stage === "listening" && state.error !== null
        ? { ...state, error: null }
        : state;
    case "muted":
      return state.stage === "off" || state.muted === event.muted
        ? state
        : { ...state, muted: event.muted };
  }
}

function markRead(
  state: VoiceSessionState,
  reply: SpokenReply,
): Pick<VoiceSessionState, "readIds" | "readRuns"> {
  return {
    readIds: [...state.readIds, reply.id],
    readRuns:
      reply.runId == null || state.readRuns.includes(reply.runId)
        ? state.readRuns
        : [...state.readRuns, reply.runId],
  };
}

/** Records where the conversation stands, so the answer to the next question can be told from what came before. */
export function replyAnchor(messages: ReadonlyArray<VoiceMessage>): ReplyAnchor {
  return { afterId: messages.at(-1)?.id ?? null, count: messages.length };
}

/**
 * Where the spoken question's own turn stands: not in the thread yet, waiting or running, held in
 * the queue, or over. "Over" includes a run that was cancelled or failed before it started.
 */
export type OwnTurn = "unknown" | "open" | "held" | "ended";

const OPEN_RUN_STATUSES: ReadonlySet<string> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

export type OwnTurnRun = Readonly<{
  id: string;
  userMessageId: string;
  status: string;
  queueHeld?: boolean | undefined;
}>;

function runTurn(run: OwnTurnRun): OwnTurn {
  if (!OPEN_RUN_STATUSES.has(run.status)) return "ended";
  return run.status === "queued" && run.queueHeld === true ? "held" : "open";
}

/**
 * Follows the question voice chat sent through its run, which the server publishes as soon as the
 * request is accepted, even when it queues behind another run. The transcript row only appears when
 * a queued run starts, so it is needed only for a steer, which joins the run it redirects.
 */
export function ownTurnState(
  messages: ReadonlyArray<VoiceMessage>,
  runs: ReadonlyArray<OwnTurnRun>,
  messageId: string | null,
): OwnTurn {
  if (messageId === null) return "unknown";
  const own = runs.find((candidate) => candidate.userMessageId === messageId);
  if (own !== undefined) return runTurn(own);
  const steer = messages.find(
    (message) => message.role === "user" && (message.messageId ?? message.id) === messageId,
  );
  if (steer === undefined) return "unknown";
  const target = steer.runId == null ? undefined : runs.find((run) => run.id === steer.runId);
  return target === undefined ? "open" : runTurn(target);
}

export type ReplySelection = Readonly<{
  /** The id the composer gave the question that was sent. Until it is known, nothing is selected. */
  messageId?: string | null;
  /** Replies and runs already read in this conversation. */
  readIds?: ReadonlyArray<string>;
  readRuns?: ReadonlyArray<string>;
}>;

/**
 * The answer to the question voice chat sent after `anchor`: the last answer in the run of the
 * new user message with the id the composer gave the question, so another client's prompt, a steer
 * or a late message of another run does not count. A message without a run (a draft) is bounded by the
 * next question. Replies already read are skipped. The answer may still be streaming.
 */
export function selectReply(
  messages: ReadonlyArray<VoiceMessage>,
  anchor: ReplyAnchor,
  selection: ReplySelection = {},
): VoiceMessage | null {
  const anchored =
    anchor.afterId === null ? -1 : messages.findIndex((m) => m.id === anchor.afterId);
  const start = anchored >= 0 ? anchored + 1 : Math.min(anchor.count, messages.length);
  const after = messages.slice(start);
  const sentId = selection.messageId ?? null;
  if (sentId === null) return null;
  const questionIndex = after.findIndex(
    (message) => message.role === "user" && (message.messageId ?? message.id) === sentId,
  );
  if (questionIndex === -1) return null;
  const question = after[questionIndex];
  const turn = after.slice(questionIndex + 1);
  const runId = question?.runId ?? null;
  // Without a run, a new question from the person ends the window; a steer does not.
  const next = turn.findIndex((message) => message.role === "user" && message.steer !== true);
  const span = runId === null ? (next === -1 ? turn : turn.slice(0, next)) : turn;
  const readIds = selection.readIds ?? [];
  const readRuns = selection.readRuns ?? [];
  const answers = span.filter(
    (message) =>
      message.role === "assistant" &&
      message.commentary !== true &&
      (runId === null || message.runId === runId) &&
      !readIds.includes(message.id) &&
      (message.runId == null || !readRuns.includes(message.runId)),
  );
  return answers.at(-1) ?? null;
}

/**
 * Whether the thread shows a secret or link request that is still pending: the agent waits on it,
 * and its card sits behind voice chat's dialog. Cards inherited from the thread this one was
 * forked from are not answered here.
 */
export function hasPendingBlockingRequest(
  rows: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
): boolean {
  return rows.some(({ item, visibility }) => {
    if (visibility !== "local") return false;
    switch (item.type) {
      case "secret_request":
        return item.secretStatus === "pending";
      case "link_request":
        return item.linkStatus === "pending";
      default:
        return false;
    }
  });
}

/**
 * The feedback cards still pending. They are optional: the agent finishes without an answer, so
 * one left over from an earlier turn must not stop voice chat from starting. Only a card that was
 * not there when voice chat started ends it, so the person can see it.
 */
export function pendingFeedbackCardIds(
  rows: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
): ReadonlyArray<string> {
  return rows.flatMap(({ item, visibility }) =>
    visibility === "local" && item.type === "feedback_request" && item.feedbackStatus === "pending"
      ? [item.id]
      : [],
  );
}

/** How long reading may take before voice chat moves on, in case the speech engine never reports its end. */
export function speechDeadlineMs(text: string): number {
  return 10_000 + text.length * 120;
}

/** Removes markup so a reply can be read aloud: no code, links become their text. */
export function speakableText(markdown: string): string {
  return (
    markdown
      .replace(/```[\s\S]*?(```|$)/g, " ")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
      .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, " ")
      // A table row is read as a short sentence: its cells separated by commas, closed by a stop.
      .replace(
        /^[ \t]*\|(.+)\|[ \t]*$/gm,
        (_row, cells: string) =>
          `${cells
            .split("|")
            .map((cell) => cell.trim())
            .filter(Boolean)
            .join(", ")}.`,
      )
      .replace(/\|/g, ", ")
      .replace(/(\*\*|__|\*|_|~~)/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*/g, "\n")
      .trim()
  );
}

export type SilenceDetectorOptions = Readonly<{
  /** Level at or above which sound counts as speech. */
  speechLevel: number;
  /** Speech needed before a pause can end the turn. */
  minSpeechMs: number;
  /** Quiet time after speech that ends the turn. */
  silenceMs: number;
}>;

const DEFAULT_SILENCE_DETECTOR: SilenceDetectorOptions = {
  speechLevel: 0.08,
  minSpeechMs: 350,
  silenceMs: 1600,
};

/**
 * Decides when the speaker has finished: enough speech, then a pause.
 * Feed it one level sample per frame; it returns true once, at the end of the turn.
 */
export function createSilenceDetector(options: SilenceDetectorOptions = DEFAULT_SILENCE_DETECTOR) {
  let speechMs = 0;
  let quietMs = 0;
  let last: number | null = null;
  let finished = false;
  return {
    sample(level: number, nowMs: number): boolean {
      if (finished) return false;
      const delta = last === null ? 0 : Math.min(250, Math.max(0, nowMs - last));
      last = nowMs;
      if (level >= options.speechLevel) {
        speechMs += delta;
        quietMs = 0;
        return false;
      }
      if (speechMs < options.minSpeechMs) return false;
      quietMs += delta;
      if (quietMs < options.silenceMs) return false;
      finished = true;
      return true;
    },
    reset() {
      speechMs = 0;
      quietMs = 0;
      last = null;
      finished = false;
    },
  };
}

let session: VoiceSessionState = VOICE_SESSION_OFF;
const listeners = new Set<() => void>();

/** How a microphone start ended: recording began, the recorder reported an error, or nothing began. */
export type VoiceStartResult = "started" | "failed" | "declined";

type MicrophoneOperation = { readonly controller: AbortController; readonly cancel: () => void };

let microphone: MicrophoneOperation | null = null;

function releaseMicrophone(operation: MicrophoneOperation): void {
  operation.controller.abort();
  if (microphone === operation) microphone = null;
}

/**
 * Starts the one microphone operation this conversation owns, registering how to stop it before
 * the start begins, for a first attempt and a retry alike. An attempt that ends without recording
 * releases its own hold at once, whether or not the recorder's phase changed, so a dictation
 * started afterwards is not ours. The promise resolves once that is settled.
 */
export function beginMicrophone(
  start: (signal: AbortSignal) => Promise<VoiceStartResult>,
  cancel: () => void,
): Promise<void> {
  // A closed conversation starts nothing.
  if (session.stage === "off") return Promise.resolve();
  // A retry replaces the operation before it.
  microphone?.controller.abort();
  const operation: MicrophoneOperation = { controller: new AbortController(), cancel };
  microphone = operation;
  return start(operation.controller.signal).then(
    (result) => {
      if (result !== "started") releaseMicrophone(operation);
    },
    () => releaseMicrophone(operation),
  );
}

/** Whether a microphone operation this conversation began is still unsettled. */
export function ownsMicrophone(): boolean {
  return microphone !== null;
}

/**
 * The operation ended on its own, or the conversation is closing without stopping a
 * recording: drop the cancellation but still tell a start that is waiting to give up.
 */
export function settleMicrophone(): void {
  if (microphone) releaseMicrophone(microphone);
}

export function dispatchVoiceSession(event: VoiceSessionEvent): void {
  const next = reduceVoiceSession(session, event);
  if (next === session) return;
  session = next;
  if (next.stage === "off") {
    const operation = microphone;
    microphone = null;
    operation?.controller.abort();
    operation?.cancel();
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  }
  for (const listener of listeners) listener();
}

let submissionCount = 0;

/** A name for one spoken question's send, so a late report from an abandoned send names nothing. */
export function newVoiceSubmission(): string {
  submissionCount += 1;
  return `voice-submission-${submissionCount}`;
}

export function getVoiceSession(): VoiceSessionState {
  return session;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether voice chat covers the conversation. A boolean snapshot, so it re-renders only when voice chat opens or closes. */
export function useVoiceStageOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => getVoiceSession().stage !== "off",
    () => false,
  );
}

export function useVoiceSession(): VoiceSessionState {
  return useSyncExternalStore(subscribe, getVoiceSession, () => VOICE_SESSION_OFF);
}
