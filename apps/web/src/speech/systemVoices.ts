import { useSyncExternalStore } from "react";

/** Voices that sing, warble or play a character; never a default for reading replies. */
const NOVELTY_VOICES = new Set([
  "albert",
  "bad news",
  "bahh",
  "bells",
  "boing",
  "bubbles",
  "cellos",
  "good news",
  "jester",
  "organ",
  "superstar",
  "trinoids",
  "whisper",
  "wobble",
  "zarvox",
  "fred",
  "junior",
  "ralph",
  "kathy",
]);

/** The name before any "(English (United States))" suffix, lowercased. */
function baseName(voice: SpeechSynthesisVoice): string {
  return voice.name
    .replace(/\s*\(.*\)\s*$/, "")
    .trim()
    .toLowerCase();
}

function isNoveltyVoice(voice: SpeechSynthesisVoice): boolean {
  return NOVELTY_VOICES.has(baseName(voice));
}

/** Higher sounds more natural. Neural and premium voices first, then the platform's usual voices. */
function quality(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase();
  if (/premium|neural|natural/.test(name)) return 5;
  if (/enhanced|siri/.test(name)) return 4;
  if (/\bonline\b|^google /.test(name)) return 3;
  if (isNoveltyVoice(voice)) return -1;
  // The newer macOS voices (Eddy, Flo, Reed, ...) carry a language suffix and sound flat.
  if (/\(.*\)/.test(voice.name)) return 1;
  return 2;
}

function sameLanguage(voice: SpeechSynthesisVoice, language: string): boolean {
  const wanted = language.toLowerCase();
  const lang = voice.lang.toLowerCase().replace("_", "-");
  return lang === wanted || lang.split("-")[0] === wanted.split("-")[0];
}

/**
 * The voice to read `language` with: the one the person chose when it speaks that language,
 * otherwise the most natural voice this device has for it. Null leaves the engine's default.
 */
export function pickSystemVoice(
  voices: ReadonlyArray<SpeechSynthesisVoice>,
  language: string,
  chosenURI: string | null,
): SpeechSynthesisVoice | null {
  const candidates = voices.filter((voice) => sameLanguage(voice, language));
  if (chosenURI !== null) {
    const chosen = candidates.find((voice) => voice.voiceURI === chosenURI);
    if (chosen) return chosen;
  }
  const exactRegion = (voice: SpeechSynthesisVoice) =>
    voice.lang.toLowerCase().replace("_", "-") === language.toLowerCase() ? 1 : 0;
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -Infinity;
  for (const voice of candidates) {
    // Local voices start at once and work offline; a remote one only wins on quality.
    const score =
      quality(voice) * 10 +
      exactRegion(voice) * 3 +
      (voice.default ? 2 : 0) +
      (voice.localService ? 1 : 0);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}

/** The voices worth offering in a picker for `language`, most natural first. */
export function listedSystemVoices(
  voices: ReadonlyArray<SpeechSynthesisVoice>,
  language: string,
): SpeechSynthesisVoice[] {
  return voices
    .filter((voice) => sameLanguage(voice, language) && !isNoveltyVoice(voice))
    .toSorted((a, b) => quality(b) - quality(a) || a.name.localeCompare(b.name));
}

const NO_VOICES: ReadonlyArray<SpeechSynthesisVoice> = [];
let voicesSnapshot: ReadonlyArray<SpeechSynthesisVoice> = NO_VOICES;

function currentVoices(): ReadonlyArray<SpeechSynthesisVoice> {
  const next = window.speechSynthesis?.getVoices() ?? NO_VOICES;
  // getVoices returns a new array each call; keep the old one while the list is the same.
  if (
    next.length !== voicesSnapshot.length ||
    next.some((voice, index) => voice.voiceURI !== voicesSnapshot[index]?.voiceURI)
  ) {
    voicesSnapshot = next.length === 0 ? NO_VOICES : next;
  }
  return voicesSnapshot;
}

function subscribeVoices(listener: () => void): () => void {
  const synthesis = window.speechSynthesis;
  synthesis?.addEventListener("voiceschanged", listener);
  return () => synthesis?.removeEventListener("voiceschanged", listener);
}

/** The voices this device lists; the list loads lazily, so it can start empty. */
export function useSystemVoices(): ReadonlyArray<SpeechSynthesisVoice> {
  return useSyncExternalStore(subscribeVoices, currentVoices, () => NO_VOICES);
}
