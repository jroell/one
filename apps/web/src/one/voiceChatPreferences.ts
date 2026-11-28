import { useSyncExternalStore } from "react";

/** How voice chat reads replies aloud. A device choice. */
export type VoiceChatStyle = "natural" | "conqueror";

/** The style a device reads in until someone picks the other one. */
export const DEFAULT_VOICE_CHAT_STYLE: VoiceChatStyle = "conqueror";

const STYLE_KEY = "one:voice-chat-style";
const listeners = new Set<() => void>();

function readStyle(): VoiceChatStyle {
  try {
    const stored = window.localStorage.getItem(STYLE_KEY);
    return stored === "natural" || stored === "conqueror" ? stored : DEFAULT_VOICE_CHAT_STYLE;
  } catch {
    return DEFAULT_VOICE_CHAT_STYLE;
  }
}

let style: VoiceChatStyle = typeof window === "undefined" ? DEFAULT_VOICE_CHAT_STYLE : readStyle();

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
    if (next === DEFAULT_VOICE_CHAT_STYLE) window.localStorage.removeItem(STYLE_KEY);
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

/** Kana letters only: the middle dot, long-vowel and iteration marks are punctuation Chinese also uses. */
const KANA = /[\u3041-\u3096\u30a1-\u30fa\uff66-\uff9d]/g;
/** Kana the Han text needs before it is Japanese: a quoted word or one stray letter is not enough. */
const KANA_MIN_LETTERS = 2;
const KANA_MIN_SHARE = 0.04;

/** Scripts whose text identifies its language, and the languages written in them. */
const SCRIPT_LANGUAGES: ReadonlyArray<readonly [RegExp, ReadonlyArray<string>, number, number?]> = [
  // Japanese text is mostly kanji with some kana, so a little kana is enough, but not one letter.
  [KANA, ["ja"], 0.1, KANA_MIN_LETTERS],
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
  for (const [script, languages, minShare, minLetters = 1] of SCRIPT_LANGUAGES) {
    const inScript = text.match(script)?.length ?? 0;
    if (inScript < minLetters || inScript / letters < minShare) continue;
    return languages.includes(page) ? pageLanguage : (languages[0] ?? pageLanguage);
  }
  // Han characters are written in Chinese, Japanese and Korean. Enough kana, or any hangul, names
  // its language (the table above caught the plain cases); other Han text keeps a Japanese,
  // Korean or Chinese page's language and is Chinese on any other page.
  const han = text.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  if (han / letters >= SCRIPT_SHARE) {
    const kana = text.match(KANA)?.length ?? 0;
    if (kana >= KANA_MIN_LETTERS && kana / letters >= KANA_MIN_SHARE) return "ja";
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
 * Shapes an utterance for the chosen style. The Conqueror is pitched down and slowed, in the
 * voice the person picked, else the deepest voice this device offers in the reply's language.
 */
export function applyVoiceChatStyle(
  utterance: SpeechSynthesisUtterance,
  voices: ReadonlyArray<SpeechSynthesisVoice>,
  chosen: VoiceChatStyle,
  keepVoice = false,
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
  if (deep && !keepVoice) utterance.voice = deep;
  utterance.pitch = 0.35;
  utterance.rate = 0.86;
}
