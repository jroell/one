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

/** Choices whose last write failed. Storage still holds the old value, so this session's choice wins. */
const unsaved: { -readonly [Name in keyof OpeningPreferences]?: boolean } = {};

/** Reads both choices; one that cannot be read keeps the value this session already holds. */
function readPreferences(held: OpeningPreferences): OpeningPreferences {
  return {
    animation: unsaved.animation ?? readOn(ANIMATION_KEY) ?? held.animation,
    sound: unsaved.sound ?? readOn(SOUND_KEY) ?? held.sound,
  };
}

let snapshot: OpeningPreferences =
  typeof window === "undefined"
    ? { animation: true, sound: true }
    : readPreferences({ animation: true, sound: true });

export function getOpeningPreferences(): OpeningPreferences {
  return snapshot;
}

/** Saves one choice; true when storage took it. */
function write(key: string, on: boolean): boolean {
  try {
    if (on) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, "off");
    return true;
  } catch {
    return false;
  }
}

/** Saves a choice; one that cannot be saved lasts for this session only, and a later save ends that. */
function save(name: keyof OpeningPreferences, key: string, on: boolean): void {
  if (write(key, on)) delete unsaved[name];
  else unsaved[name] = on;
}

/** Saves only the choice that changed, so another window's change to the other one survives. */
export function setOpeningPreferences(next: Partial<OpeningPreferences>): void {
  if (next.animation !== undefined) save("animation", ANIMATION_KEY, next.animation);
  if (next.sound !== undefined) save("sound", SOUND_KEY, next.sound);
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
  // Another window changed a choice, or cleared storage (a null key): read both again.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== ANIMATION_KEY && event.key !== SOUND_KEY) return;
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
