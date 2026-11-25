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

// Another window changed the choice: the switch and the next reply must use it. This
// listens for the life of the page, so a reply read while Settings is closed is current too.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== STYLE_KEY) return;
    const next = readStyle();
    if (next === style) return;
    style = next;
    for (const listener of listeners) listener();
  });
}

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

/** A script has to make up this share of the letters; a quoted word in another script does not change the language. */
const SCRIPT_SHARE = 0.3;

/** Scripts whose text identifies its language, and the languages written in them. */
const SCRIPT_LANGUAGES: ReadonlyArray<readonly [RegExp, ReadonlyArray<string>, number]> = [
  // Japanese text is mostly kanji with some kana, so a little kana is enough.
  [/[\u3040-\u30ff]/g, ["ja"], 0.1],
  [/[\uac00-\ud7af]/g, ["ko"], SCRIPT_SHARE],
  [/[\u0400-\u04ff]/g, ["ru", "uk", "bg", "sr", "be", "mk"], SCRIPT_SHARE],
  [/[\u0600-\u06ff]/g, ["ar", "fa", "ur"], SCRIPT_SHARE],
  [/[\u0590-\u05ff]/g, ["he"], SCRIPT_SHARE],
  [/[\u0370-\u03ff]/g, ["el"], SCRIPT_SHARE],
  [/[\u0900-\u097f]/g, ["hi", "mr", "ne"], SCRIPT_SHARE],
  [/[\u0e00-\u0e7f]/g, ["th"], SCRIPT_SHARE],
];

/**
 * The language to read `text` in. The page language, unless the reply is plainly
 * written in another script (a Japanese reply on an English page): then that language.
 * Latin-script languages cannot be told apart cheaply, so those keep the page language.
 */
export function replyLanguage(text: string, pageLanguage: string): string {
  const page = pageLanguage.slice(0, 2).toLowerCase();
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (letters === 0) return pageLanguage;
  for (const [script, languages, minShare] of SCRIPT_LANGUAGES) {
    const inScript = text.match(script)?.length ?? 0;
    if (inScript / letters < minShare) continue;
    return languages.includes(page) ? pageLanguage : (languages[0] ?? pageLanguage);
  }
  // Han characters are written in Chinese, Japanese and Korean. Kana or hangul anywhere in the
  // text names its language (the table above caught the plain cases); Han-only text keeps a
  // Japanese or Korean page's language and is Chinese on any other page.
  const han = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  if (han / letters >= SCRIPT_SHARE) {
    if (/[\u3040-\u30ff]/.test(text)) return "ja";
    if (/[\uac00-\ud7af]/.test(text)) return "ko";
    return page === "ja" || page === "ko" || page === "zh" ? pageLanguage : "zh";
  }
  return pageLanguage;
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
