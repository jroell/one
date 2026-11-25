import { useSyncExternalStore } from "react";

/**
 * A spoken conversation, one turn at a time:
 * listening -> sending -> thinking -> speaking -> listening ...
 */
export type VoiceStage = "off" | "listening" | "sending" | "thinking" | "speaking";

export type VoiceSessionState = Readonly<{
  stage: VoiceStage;
  /** The thread (or draft) this conversation belongs to. Voice chat never follows you to another thread. */
  threadKey: string | null;
  /** The newest assistant message when the current question was sent, so only a newer one is read aloud. */
  baselineMessageId: string | null;
}>;

export type VoiceSessionEvent =
  | { readonly type: "start"; readonly threadKey: string }
  | { readonly type: "stop" }
  | { readonly type: "sent"; readonly latestAssistantMessageId: string | null }
  | { readonly type: "working" }
  | { readonly type: "replied"; readonly hasNewReply: boolean }
  | { readonly type: "spoken" }
  | { readonly type: "failed" };

export const VOICE_SESSION_OFF: VoiceSessionState = {
  stage: "off",
  threadKey: null,
  baselineMessageId: null,
};

export function reduceVoiceSession(
  state: VoiceSessionState,
  event: VoiceSessionEvent,
): VoiceSessionState {
  switch (event.type) {
    case "start":
      return state.stage === "off"
        ? { stage: "listening", threadKey: event.threadKey, baselineMessageId: null }
        : state;
    case "stop":
      return VOICE_SESSION_OFF;
    case "sent":
      return state.stage === "listening"
        ? { ...state, stage: "sending", baselineMessageId: event.latestAssistantMessageId }
        : state;
    case "working":
      return state.stage === "sending" ? { ...state, stage: "thinking" } : state;
    case "replied":
      if (state.stage !== "thinking") return state;
      // A turn that ends with nothing new to read goes straight back to listening.
      return { ...state, stage: event.hasNewReply ? "speaking" : "listening" };
    case "spoken":
      return state.stage === "speaking"
        ? { ...state, stage: "listening", baselineMessageId: null }
        : state;
    case "failed":
      // Nothing was heard or the send was refused: listen again rather than hang.
      return state.stage === "sending"
        ? { ...state, stage: "listening", baselineMessageId: null }
        : state;
  }
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

export function dispatchVoiceSession(event: VoiceSessionEvent): void {
  const next = reduceVoiceSession(session, event);
  if (next === session) return;
  session = next;
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
