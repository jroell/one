import { useSyncExternalStore } from "react";

/** How voice chat reads replies aloud. A device choice. */
export type VoiceChatStyle = "natural" | "conqueror";

const STYLE_KEY = "one:voice-chat-style";
const listeners = new Set<() => void>();

function readStyle(): VoiceChatStyle {
  try {
    return window.localStorage.getItem(STYLE_KEY) === "conqueror" ? "conqueror" : "natural";
  } catch {
    return "natural";
  }
}

let style: VoiceChatStyle = typeof window === "undefined" ? "natural" : readStyle();

export function getVoiceChatStyle(): VoiceChatStyle {
  return style;
}

export function setVoiceChatStyle(next: VoiceChatStyle): void {
  style = next;
  try {
    if (next === "natural") window.localStorage.removeItem(STYLE_KEY);
    else window.localStorage.setItem(STYLE_KEY, next);
  } catch {
    // Without storage the choice lasts for this session only.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVoiceChatStyle(): VoiceChatStyle {
  return useSyncExternalStore(subscribe, getVoiceChatStyle, getVoiceChatStyle);
}

/** Names of deep system voices, best first. Matched as a prefix of the voice name. */
const DEEP_VOICE_NAMES = [
  "Daniel",
  "Arthur",
  "Aaron",
  "Fred",
  "Google UK English Male",
  "Microsoft George",
  "Microsoft David",
  "Microsoft Mark",
  "Alex",
];

/**
 * Shapes an utterance for the chosen style. The Conqueror is the deepest voice
 * this device offers in the reply's language, pitched down and slowed.
 */
export function applyVoiceChatStyle(
  utterance: SpeechSynthesisUtterance,
  voices: ReadonlyArray<SpeechSynthesisVoice>,
  chosen: VoiceChatStyle,
): void {
  if (chosen === "natural") {
    utterance.rate = 1.04;
    return;
  }
  const language = utterance.lang.slice(0, 2).toLowerCase();
  const sameLanguage = voices.filter((voice) => voice.lang.toLowerCase().startsWith(language));
  const deep = DEEP_VOICE_NAMES.map((name) =>
    sameLanguage.find((voice) => voice.name.startsWith(name)),
  ).find((voice) => voice !== undefined);
  if (deep) utterance.voice = deep;
  utterance.pitch = 0.35;
  utterance.rate = 0.86;
}
