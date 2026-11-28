import type { CloudSpeechAudioFormat } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

/**
 * The voice replies are read in, a choice of this device. A system voice stays on the device; a
 * cloud voice sends each reply's text to OpenRouter through the environment that holds the key.
 */
export type ReadAloudVoice =
  | { readonly kind: "system"; readonly voiceURI: string | null }
  | {
      readonly kind: "cloud";
      readonly environmentId: string;
      readonly model: string;
      readonly voice: string;
      readonly format: CloudSpeechAudioFormat;
    };

export const SYSTEM_READ_ALOUD_VOICE: ReadAloudVoice = { kind: "system", voiceURI: null };

const VOICE_KEY = "one:read-aloud-voice";
const RATE_KEY = "one:read-aloud-rate";
/** Reading speeds offered, as a multiple of the voice's normal pace. */
export const READ_ALOUD_RATES = [0.9, 1, 1.15, 1.3, 1.5] as const;
export type ReadAloudRate = (typeof READ_ALOUD_RATES)[number];

const listeners = new Set<() => void>();

function parseVoice(raw: string | null): ReadAloudVoice {
  if (raw === null) return SYSTEM_READ_ALOUD_VOICE;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return SYSTEM_READ_ALOUD_VOICE;
    const record = value as Record<string, unknown>;
    if (record.kind === "system") {
      return {
        kind: "system",
        voiceURI: typeof record.voiceURI === "string" ? record.voiceURI : null,
      };
    }
    if (
      record.kind === "cloud" &&
      typeof record.environmentId === "string" &&
      typeof record.model === "string" &&
      typeof record.voice === "string" &&
      (record.format === "mp3" || record.format === "wav")
    ) {
      return {
        kind: "cloud",
        environmentId: record.environmentId,
        model: record.model,
        voice: record.voice,
        format: record.format,
      };
    }
  } catch {
    // A value another version wrote: fall back to the device voice.
  }
  return SYSTEM_READ_ALOUD_VOICE;
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseRate(raw: string | null): ReadAloudRate {
  const value = Number(raw);
  return READ_ALOUD_RATES.find((rate) => rate === value) ?? 1;
}

const hasWindow = typeof window !== "undefined";
let voice: ReadAloudVoice = hasWindow ? parseVoice(readStored(VOICE_KEY)) : SYSTEM_READ_ALOUD_VOICE;
let rate: ReadAloudRate = hasWindow ? parseRate(readStored(RATE_KEY)) : 1;

function notify(): void {
  for (const listener of listeners) listener();
}

// Another window changed the choice; the next reading here uses it too.
if (hasWindow) {
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === VOICE_KEY) voice = parseVoice(readStored(VOICE_KEY));
    if (event.key === null || event.key === RATE_KEY) rate = parseRate(readStored(RATE_KEY));
    notify();
  });
}

function store(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Without storage the choice lasts for this session only.
  }
}

function getReadAloudVoice(): ReadAloudVoice {
  return voice;
}

export function setReadAloudVoice(next: ReadAloudVoice): void {
  voice = next;
  store(VOICE_KEY, next.kind === "system" && next.voiceURI === null ? null : JSON.stringify(next));
  notify();
}

function getReadAloudRate(): ReadAloudRate {
  return rate;
}

export function setReadAloudRate(next: ReadAloudRate): void {
  rate = next;
  store(RATE_KEY, next === 1 ? null : String(next));
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReadAloudVoice(): ReadAloudVoice {
  return useSyncExternalStore(subscribe, getReadAloudVoice, () => SYSTEM_READ_ALOUD_VOICE);
}

export function useReadAloudRate(): ReadAloudRate {
  return useSyncExternalStore(subscribe, getReadAloudRate, () => 1 as const);
}
