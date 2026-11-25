import { msg } from "gt-react-native";

import { getLocalVoiceTranscriber } from "../../../native/voiceTranscription";
import { m } from "../../../i18n/messages";
import { buildWavFromPcm16 } from "./pcmAudio";

const WAV_SAMPLE_RATE = 24_000;

/** Turns one captured utterance of 24 kHz mono PCM16 into text, or null when nothing was said. */
export type PcmTranscriber = (
  pcm24kBytes: Uint8Array,
  signal: AbortSignal,
) => Promise<string | null>;

/**
 * React Native's `Blob` rejects ArrayBuffer parts, so audio always goes through a real file:
 * the on-device speech engines read its URI and the OpenAI upload appends the file to FormData.
 */
async function withTemporaryWav<T>(
  pcm24kBytes: Uint8Array,
  use: (file: import("expo-file-system").File) => Promise<T>,
): Promise<T> {
  const { File, Paths } = await import("expo-file-system");
  const file = new File(
    Paths.cache,
    `one-drive-turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`,
  );
  file.create({ overwrite: true });
  try {
    await file.write(buildWavFromPcm16(pcm24kBytes, WAV_SAMPLE_RATE));
    return await use(file);
  } finally {
    try {
      file.delete();
    } catch {
      // The cache directory is cleaned by the system if a delete fails.
    }
  }
}

/**
 * The phone's own speech recognition (Apple Speech on iOS, Google speech services on Android),
 * the same engine the composer's dictation uses. Needs no key and sends no audio off the device.
 * Resolves null when this device has none.
 */
export async function createLocalPcmTranscriber(
  signal: AbortSignal,
): Promise<PcmTranscriber | null> {
  const transcriber = await getLocalVoiceTranscriber();
  if (!transcriber) return null;
  const prepared = await transcriber.prepare({ signal });
  return (pcm24kBytes, turnSignal) =>
    withTemporaryWav(pcm24kBytes, async (file) => {
      const text = await prepared.transcribe(file.uri, { signal: turnSignal });
      const trimmed = text.trim();
      return trimmed.length > 0 ? trimmed : null;
    });
}

export function createOpenAiPcmTranscriber(options: {
  readonly apiKey: string;
  readonly fetchImpl: typeof fetch;
}): PcmTranscriber {
  return (pcm24kBytes, signal) =>
    withTemporaryWav(pcm24kBytes, async (file) => {
      const form = new FormData();
      form.append("file", file as unknown as Blob, "turn.wav");
      form.append("model", "gpt-4o-mini-transcribe");
      const response = await options.fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}` },
        body: form,
        signal,
      });
      if (!response.ok) {
        throw new Error(
          m(msg("OpenAI could not transcribe that ({status}). Check the OpenAI key in setup."), {
            status: response.status,
          }),
        );
      }
      const json = (await response.json()) as { readonly text?: unknown };
      return typeof json.text === "string" && json.text.trim().length > 0 ? json.text.trim() : null;
    });
}
