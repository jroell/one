import { useSyncExternalStore } from "react";

/** Device choices for the opening: whether it plays, and whether it makes sound. */
export type OpeningPreferences = Readonly<{ animation: boolean; sound: boolean }>;

const ANIMATION_KEY = "one:opening";
const SOUND_KEY = "one:opening-sound";
export const OPENING_SEEN_KEY = "one:opening-seen";

const listeners = new Set<() => void>();
const replayListeners = new Set<() => void>();

/** Whether the stored choice is on; `undefined` when storage cannot be read, which is not "unset". */
function readOn(key: string): boolean | undefined {
  try {
    return window.localStorage.getItem(key) !== "off";
  } catch {
    return undefined;
  }
}

/** Reads both choices; one that cannot be read keeps the value this session already holds. */
function readPreferences(held: OpeningPreferences): OpeningPreferences {
  return {
    animation: readOn(ANIMATION_KEY) ?? held.animation,
    sound: readOn(SOUND_KEY) ?? held.sound,
  };
}

let snapshot: OpeningPreferences =
  typeof window === "undefined"
    ? { animation: true, sound: true }
    : readPreferences({ animation: true, sound: true });

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
  const fresh = readPreferences(snapshot);
  if (fresh.animation !== snapshot.animation || fresh.sound !== snapshot.sound) {
    snapshot = fresh;
    queueMicrotask(() => {
      for (const each of listeners) each();
    });
  }
  // Another window changed a choice: read both again.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== ANIMATION_KEY && event.key !== SOUND_KEY) return;
    snapshot = readPreferences(snapshot);
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
