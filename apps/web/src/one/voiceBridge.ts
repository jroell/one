import type { VoiceInputPhase } from "@t3tools/client-runtime/voice-input";
import { useSyncExternalStore } from "react";

/**
 * What the visible composer offers for dictation. The composer owns voice
 * input (models, consent, the draft); voice chat only drives it through here.
 */
export type VoiceBridge = Readonly<{
  available: boolean;
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

export function publishVoiceBridge(ownerKey: string, next: VoiceBridge, level: number): void {
  voiceLevel.current = level;
  const previous = bridge;
  owner = ownerKey;
  bridge = next;
  if (
    previous === null ||
    previous.available !== next.available ||
    previous.phase !== next.phase ||
    previous.error !== next.error ||
    previous.heard !== next.heard
  ) {
    emit();
  }
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

function getVoiceBridge(): VoiceBridge | null {
  return bridge;
}

export function useVoiceBridge(): VoiceBridge | null {
  return useSyncExternalStore(subscribe, getVoiceBridge, () => null);
}
