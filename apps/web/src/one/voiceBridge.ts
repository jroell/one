import type { VoiceInputPhase } from "@t3tools/client-runtime/voice-input";
import { useSyncExternalStore } from "react";

import { dispatchVoiceSession, getVoiceSession, type VoiceStartResult } from "./voiceSession";

/** What the composer tells voice chat about the one send it was asked to make. */
export type VoiceSendReport = Readonly<{
  /** The turn request goes out with this message id. */
  sent: (messageId: string) => void;
  /** The server or transport refused the turn request; `message` is its reason, if it gave one. */
  rejected: (message: string | null) => void;
  /** The composer ended without sending a turn: a side chat command, or a send it dropped. */
  notSent: (destination: "side-chat" | "none") => void;
  /** Set only by the app's own guided send: the server accepted the turn request. */
  accepted?: (messageId: string) => void;
  /** Set only by the app's own guided send: hidden notes that ride with this one message. */
  agentContext?: string;
}>;

/**
 * What the main composer offers for dictation. The composer owns voice input
 * (models, consent, the draft); voice chat only drives it through here.
 */
export type VoiceBridge = Readonly<{
  /** The thread or draft the composer is writing to. */
  threadKey: string;
  /** A new thread that has not been sent yet; its key changes when the first message is sent. */
  isDraft: boolean;
  /** Whether this composer's thread is what the unsent draft with that key became when it was sent. */
  continuesDraft: (draftKey: string) => boolean;
  /** Dictation can start: voice input is set up and this composer may send. */
  available: boolean;
  /** No transcription source is chosen yet, so starting opens Voice settings instead of recording. */
  needsSetup: boolean;
  /** Nothing is typed or attached, so a spoken question is sent on its own. */
  draftEmpty: boolean;
  phase: VoiceInputPhase;
  error: string | null;
  /** Words heard so far in this recording. */
  heard: string;
  /**
   * Begins recording. A start that is still waiting on a status check gives up once `signal` aborts.
   * Resolves when this attempt has either begun recording or ended without recording.
   */
  start: (signal?: AbortSignal) => Promise<VoiceStartResult>;
  /**
   * Stops recording, waits for the transcript, and sends it. Exactly one of `report`'s calls
   * says how the send went; `sent` comes at the moment the turn request goes out with its id.
   */
  submit: (report: VoiceSendReport) => void;
  cancel: () => void;
}>;

/** Live microphone level, 0 to 1. Read per frame by the ring; never triggers a render. */
export const voiceLevel = { current: 0 };

let bridge: VoiceBridge | null = null;
let owner: string | null = null;
let committed: { readonly owner: string; readonly threadKey: string } | null = null;
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

/**
 * Called by the composer in the commit that makes `threadKey` its thread, before any
 * passive effect publishes that thread's controls. A conversation that belongs to
 * another thread ends here, in the same commit, so nothing queued for it can still
 * reach the new thread. The draft the thread was sent from is the same conversation.
 */
export function commitVoiceThread(
  ownerKey: string,
  threadKey: string,
  continuesDraft: (draftKey: string) => boolean,
): void {
  committed = { owner: ownerKey, threadKey };
  const current = getVoiceSession();
  if (current.stage === "off" || current.threadKey === null || current.threadKey === threadKey)
    return;
  const sameConversation =
    current.startedAsDraft && current.stage !== "listening" && continuesDraft(current.threadKey);
  dispatchVoiceSession(sameConversation ? { type: "promoted", threadKey } : { type: "stop" });
}

/** The thread the hosting composer has committed, or null before one has or after it left. */
export function getCommittedVoiceThreadKey(): string | null {
  return committed?.threadKey ?? null;
}

/**
 * Runs `action` only while the composer still shows `threadKey`. Controls published
 * for one thread stay in a queued frame or timer after the composer moved on; this
 * keeps them from acting on the thread it moved to.
 */
export function whileCommitted<T>(
  ownerKey: string,
  threadKey: string,
  action: () => T,
): T | undefined {
  if (committed?.owner === ownerKey && committed.threadKey === threadKey) return action();
  return undefined;
}

export function retractVoiceBridge(ownerKey: string): void {
  if (committed?.owner === ownerKey) committed = null;
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
