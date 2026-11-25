import { useSyncExternalStore } from "react";

/** Device choices for the opening: whether it plays, and whether it makes sound. */
export type OpeningPreferences = Readonly<{ animation: boolean; sound: boolean }>;

const ANIMATION_KEY = "one:opening";
const SOUND_KEY = "one:opening-sound";
export const OPENING_SEEN_KEY = "one:opening-seen";

const listeners = new Set<() => void>();
const replayListeners = new Set<() => void>();

function readOff(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "off";
  } catch {
    return false;
  }
}

let snapshot: OpeningPreferences =
  typeof window === "undefined"
    ? { animation: true, sound: true }
    : { animation: !readOff(ANIMATION_KEY), sound: !readOff(SOUND_KEY) };

export function getOpeningPreferences(): OpeningPreferences {
  return snapshot;
}

export function setOpeningPreferences(next: Partial<OpeningPreferences>): void {
  snapshot = { ...snapshot, ...next };
  try {
    for (const [key, on] of [
      [ANIMATION_KEY, snapshot.animation],
      [SOUND_KEY, snapshot.sound],
    ] as const) {
      if (on) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, "off");
    }
  } catch {
    // Without storage the choice lasts for this session only.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOpeningPreferences(): OpeningPreferences {
  return useSyncExternalStore(subscribe, getOpeningPreferences, getOpeningPreferences);
}

/** Plays the opening again now, from Settings or the command palette. */
export function replayOpening(): void {
  for (const listener of replayListeners) listener();
}

export function onReplayOpening(listener: () => void): () => void {
  replayListeners.add(listener);
  return () => replayListeners.delete(listener);
}
