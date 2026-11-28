import { synthesizeCloudSpeech } from "@t3tools/client-runtime/voice-input";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useGT } from "gt-react";
import { useSyncExternalStore } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { speakableText } from "~/one/voiceSession";
import { toastManager } from "../components/ui/toast";
import { useEnvironment } from "../state/environments";
import { usePreparedConnection } from "../state/session";
import { useReadAloudRate, useReadAloudVoice } from "./readAloudVoice";
import { runEnvironmentSpeech } from "./runEnvironmentSpeech";
import {
  claimSpeech,
  createCloudEngine,
  createSystemEngine,
  startSpeech,
  type SpeechEngine,
  type SpeechPlayback,
  type SpeechPlaybackHandlers,
} from "./speechOutput";

export type SpeechEngines = Readonly<{
  primary: SpeechEngine | null;
  fallback: SpeechEngine | null;
  /** Says once per reading that the cloud voice failed and the device voice took over. */
  onFallback: (error: unknown) => void;
}>;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

/**
 * Builds the engines for the voice chosen in Settings: a cloud voice through the environment that
 * holds the OpenRouter key, with the device voice as its fallback, or the device voice alone.
 */
export function useSpeechEngines(): () => SpeechEngines {
  const gt = useGT();
  const voice = useReadAloudVoice();
  const rate = useReadAloudRate();
  const cloudEnvironmentId = voice.kind === "cloud" ? (voice.environmentId as EnvironmentId) : null;
  const environment = useEnvironment(cloudEnvironmentId);
  const prepared = Option.getOrNull(usePreparedConnection(cloudEnvironmentId));
  const cloudReady =
    environment?.serverConfig?.environment.capabilities.cloudSpeechSynthesis === true &&
    prepared !== null;
  return useStableCallback((): SpeechEngines => {
    const device = createSystemEngine({
      voiceURI: voice.kind === "system" ? voice.voiceURI : null,
      rate,
    });
    const onFallback = (error: unknown) =>
      toastManager.add({
        type: "warning",
        title: gt("Reading with this device’s voice"),
        description: gt("The OpenRouter voice failed: {reason}", { reason: errorMessage(error) }),
      });
    if (voice.kind !== "cloud" || !cloudReady || prepared === null) {
      return { primary: device, fallback: null, onFallback };
    }
    const { model, format } = voice;
    const cloud = createCloudEngine({
      format,
      rate,
      synthesize: (text, signal) =>
        runEnvironmentSpeech(
          synthesizeCloudSpeech(
            prepared,
            { model, voice: voice.voice, text },
            () => !signal.aborted,
          ),
          { signal },
        ),
    });
    return { primary: cloud, fallback: device, onFallback };
  });
}

/** Starts reading `text` with these engines as the only reading; null when no engine can speak. */
export function speakWith(
  engines: SpeechEngines,
  handlers: SpeechPlaybackHandlers = {},
): SpeechPlayback | null {
  if (engines.primary === null) return null;
  return claimSpeech(
    startSpeech(engines.primary, engines.fallback, {
      ...handlers,
      onFallback: (error) => {
        engines.onFallback(error);
        handlers.onFallback?.(error);
      },
    }),
  );
}

let readingId: string | null = null;
let reading: SpeechPlayback | null = null;
const listeners = new Set<() => void>();

function setReading(id: string | null, playback: SpeechPlayback | null): void {
  readingId = id;
  reading = playback;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the message with this id is being read aloud. */
export function useIsReadingAloud(id: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => readingId === id,
    () => false,
  );
}

/** Whether any reply is being read aloud with the Read aloud button. */
export function useIsAnyReadingAloud(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => readingId !== null,
    () => false,
  );
}

export function stopReadingAloud(): void {
  reading?.stop();
  setReading(null, null);
}

/** Reads a reply aloud as the device reads it in voice chat: no code, no addresses. */
export function readAloud(id: string, markdown: string, engines: SpeechEngines): boolean {
  stopReadingAloud();
  const text = speakableText(markdown);
  if (!text) return false;
  const playback = speakWith(engines);
  if (playback === null) return false;
  setReading(id, playback);
  playback.update(text, true);
  void playback.done.finally(() => {
    if (reading === playback) setReading(null, null);
  });
  return true;
}
