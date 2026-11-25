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
}>;

/** Where the conversation stood when a question was sent. The answer is whatever follows. */
export type ReplyAnchor = Readonly<{ afterId: string | null; count: number }>;

/** The reply being read aloud. Fixed when reading begins, so later messages cannot replace it. */
export type SpokenReply = Readonly<{ id: string; text: string }>;

export type VoiceSessionState = Readonly<{
  stage: VoiceStage;
  /** The thread (or draft) this conversation belongs to. Voice chat never follows you to another thread. */
  threadKey: string | null;
  /** Started in an unsent draft, whose key changes once when its first message is sent. */
  startedAsDraft: boolean;
  /** The conversation as it stood when the current question was sent; only what follows can be its answer. */
  sentAfter: ReplyAnchor | null;
  /** The reply being read aloud. */
  reply: SpokenReply | null;
  /** Why the last turn could not be sent, shown with a way to try again. */
  error: string | null;
}>;

export type VoiceSessionEvent =
  | { readonly type: "start"; readonly threadKey: string; readonly isDraft?: boolean }
  /** The draft this conversation started in became a saved thread when its first question was sent. */
  | { readonly type: "promoted"; readonly threadKey: string }
  | { readonly type: "stop" }
  | { readonly type: "sent"; readonly after: ReplyAnchor }
  | { readonly type: "working" }
  /** The turn is over. `reply` is its finished answer, or null when it ended with nothing to read. */
  | { readonly type: "replied"; readonly reply: SpokenReply | null }
  /** Reading ended. With `replyId`, only the reply that was being read can end it. */
  | { readonly type: "spoken"; readonly replyId?: string }
  | { readonly type: "failed"; readonly message?: string }
  /** The person asked to try the microphone again. */
  | { readonly type: "retried" };

export const VOICE_SESSION_OFF: VoiceSessionState = {
  stage: "off",
  threadKey: null,
  startedAsDraft: false,
  sentAfter: null,
  reply: null,
  error: null,
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
        ? { ...state, stage: "sending", sentAfter: event.after, reply: null, error: null }
        : state;
    case "working":
      return state.stage === "sending" ? { ...state, stage: "thinking" } : state;
    case "replied":
      // A reply can be seen finished before any frame showed the thread working.
      if (state.stage === "thinking") {
        // A turn that ends with nothing to read goes straight back to listening.
        return event.reply === null
          ? { ...state, stage: "listening", sentAfter: null, reply: null }
          : { ...state, stage: "speaking", reply: event.reply };
      }
      return state.stage === "sending" && event.reply !== null
        ? { ...state, stage: "speaking", reply: event.reply }
        : state;
    case "spoken":
      if (state.stage !== "speaking") return state;
      // A late end event of an earlier reading must not finish this one.
      if (event.replyId !== undefined && event.replyId !== state.reply?.id) return state;
      return { ...state, stage: "listening", sentAfter: null, reply: null };
    case "failed":
      // Nothing was heard or the send was refused: listen again rather than hang.
      return state.stage === "sending"
        ? { ...state, stage: "listening", sentAfter: null, error: event.message ?? null }
        : state;
    case "retried":
      return state.stage === "listening" && state.error !== null
        ? { ...state, error: null }
        : state;
  }
}

/** Records where the conversation stands, so the answer to the next question can be told from what came before. */
export function replyAnchor(messages: ReadonlyArray<VoiceMessage>): ReplyAnchor {
  return { afterId: messages.at(-1)?.id ?? null, count: messages.length };
}

/**
 * The answer to the question sent at `anchor`: the last answer the agent gave before
 * the next question, so a queued follow-up or a later message never replaces it.
 * It may still be streaming; the caller waits for it.
 */
export function selectReply(
  messages: ReadonlyArray<VoiceMessage>,
  anchor: ReplyAnchor,
): VoiceMessage | null {
  const anchored =
    anchor.afterId === null ? -1 : messages.findIndex((m) => m.id === anchor.afterId);
  const start = anchored >= 0 ? anchored + 1 : Math.min(anchor.count, messages.length);
  const after = messages.slice(start);
  // The first user message after the anchor is the spoken question; its answer ends at the next one.
  const question = after.findIndex((message) => message.role === "user");
  const turn = question === -1 ? after : after.slice(question + 1);
  const next = turn.findIndex((message) => message.role === "user");
  const answers = (next === -1 ? turn : turn.slice(0, next)).filter(
    (message) => message.role === "assistant" && message.commentary !== true,
  );
  return answers.at(-1) ?? null;
}

/** How long reading may take before voice chat moves on, in case the speech engine never reports its end. */
export function speechDeadlineMs(text: string): number {
  return 10_000 + text.length * 120;
}

/** Removes markup so a reply can be read aloud: no code, links become their text. */
export function speakableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, " ")
    .replace(/\|/g, ", ")
    .replace(/(\*\*|__|\*|_|~~)/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
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

let microphone: { readonly controller: AbortController; readonly cancel: () => void } | null = null;

/**
 * Starts the one microphone operation this conversation owns, and registers how to
 * stop it before the start begins, so ending the conversation always reaches it:
 * the recording is cancelled and `start` is told through its signal to give up if it
 * is still waiting on a status check. Use it for a first attempt and for a retry.
 */
export function beginMicrophone(start: (signal: AbortSignal) => void, cancel: () => void): void {
  // A closed conversation starts nothing.
  if (session.stage === "off") return;
  // A retry replaces the operation before it.
  microphone?.controller.abort();
  const controller = new AbortController();
  microphone = { controller, cancel };
  start(controller.signal);
}

/**
 * The operation ended on its own, or the conversation is closing without stopping a
 * recording: drop the cancellation but still tell a start that is waiting to give up.
 */
export function settleMicrophone(): void {
  microphone?.controller.abort();
  microphone = null;
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

export function getVoiceSession(): VoiceSessionState {
  return session;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVoiceSession(): VoiceSessionState {
  return useSyncExternalStore(subscribe, getVoiceSession, () => VOICE_SESSION_OFF);
}
