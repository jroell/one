import type { VoiceInputPhase } from "@t3tools/client-runtime/voice-input";
import { useSyncExternalStore } from "react";

/**
 * What the main composer offers for dictation. The composer owns voice input
 * (models, consent, the draft); voice chat only drives it through here.
 */
export type VoiceBridge = Readonly<{
  /** The thread or draft the composer is writing to. */
  threadKey: string;
  /** Dictation can start: voice input is set up and this composer may send. */
  available: boolean;
  /** Nothing is typed or attached, so a spoken question is sent on its own. */
  draftEmpty: boolean;
  phase: VoiceInputPhase;
  error: string | null;
  /** Words heard so far in this recording. */
  heard: string;
  start: () => void;
  /** Stops recording, waits for the transcript, and sends it. */
  submit: () => void;
  cancel: () => void;
}>;

/** Live microphone level, 0 to 1. Read per frame by the ring; never triggers a render. */
export const voiceLevel = { current: 0 };

let bridge: VoiceBridge | null = null;
let owner: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Called by the one composer that hosts voice chat, whenever what it offers changes. */
export function publishVoiceBridge(ownerKey: string, next: VoiceBridge): void {
  owner = ownerKey;
  bridge = next;
  emit();
}

export function retractVoiceBridge(ownerKey: string): void {
  if (owner !== ownerKey) return;
  owner = null;
  bridge = null;
  voiceLevel.current = 0;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getVoiceBridge(): VoiceBridge | null {
  return bridge;
}

export function useVoiceBridge(): VoiceBridge | null {
  return useSyncExternalStore(subscribe, getVoiceBridge, () => null);
}
