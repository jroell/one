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

function write(key: string, on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, "off");
  } catch {
    // Without storage the choice lasts for this session only.
  }
}

/** Saves only the choice that changed, so another window's change to the other one survives. */
export function setOpeningPreferences(next: Partial<OpeningPreferences>): void {
  if (next.animation !== undefined) write(ANIMATION_KEY, next.animation);
  if (next.sound !== undefined) write(SOUND_KEY, next.sound);
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another window may have changed a choice while nothing here was listening.
  const fresh = { animation: !readOff(ANIMATION_KEY), sound: !readOff(SOUND_KEY) };
  if (fresh.animation !== snapshot.animation || fresh.sound !== snapshot.sound) {
    snapshot = fresh;
    queueMicrotask(() => {
      for (const each of listeners) each();
    });
  }
  // Another window changed a choice: read both again.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== ANIMATION_KEY && event.key !== SOUND_KEY) return;
    snapshot = { animation: !readOff(ANIMATION_KEY), sound: !readOff(SOUND_KEY) };
    for (const each of listeners) each();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
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
