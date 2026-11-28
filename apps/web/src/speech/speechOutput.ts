// @effect-diagnostics globalTimers:off - the speech engines are browser callbacks with their own watchdog timers.
import { applyVoiceChatStyle, getVoiceChatStyle, replyLanguage } from "~/one/voiceChatPreferences";
import { speechDeadlineMs } from "~/one/voiceSession";
import { speechChunks, spokenForm, type SpeechChunk } from "./speechChunks";
import { pickSystemVoice } from "./systemVoices";

/** How long a chunk may take to begin before an idle synthesizer is taken to have dropped it. */
const SPEECH_START_MS = 4_000;
/** How long a chunk the engine holds back may wait for its start event before it is retried once. */
const SPEECH_ENGINE_START_MS = 6_000;
/** How long the first reading waits for the device to list its voices. */
const VOICES_WAIT_MS = 1_500;

// The device lists its voices lazily; asking early gives it time to answer before the first reading.
if (typeof window !== "undefined") window.speechSynthesis?.getVoices();

export type ChunkEvents = Readonly<{
  /** The engine began speaking the chunk. */
  onStart: () => void;
  /** The voice reached this many characters into the chunk. */
  onProgress: (charIndex: number) => void;
}>;

/** Something that can say one chunk. `prepare` may start work ahead of time (a download). */
export type SpeechEngine = Readonly<{
  /** True for engines that pay a delay per request, which favors a short first chunk. */
  remote: boolean;
  prepare: (chunk: SpeechChunk) => PreparedChunk;
}>;

export type PreparedChunk = Readonly<{
  play: (events: ChunkEvents, signal: AbortSignal) => Promise<void>;
  release: () => void;
}>;

function abortError(): Error {
  return new DOMException("Speech stopped", "AbortError");
}

function waitForVoices(synthesis: SpeechSynthesis, signal: AbortSignal): Promise<void> {
  if (synthesis.getVoices().length > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      synthesis.removeEventListener("voiceschanged", done);
      signal.removeEventListener("abort", done);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(done, VOICES_WAIT_MS);
    synthesis.addEventListener("voiceschanged", done);
    signal.addEventListener("abort", done);
  });
}

/**
 * The device's own speech engine, one utterance per chunk. Short utterances avoid the cut-off
 * some browsers apply to long ones, and the watchdogs move on from an engine that drops one.
 */
export function createSystemEngine(input: {
  readonly voiceURI: string | null;
  readonly rate: number;
  readonly pageLanguage?: string;
}): SpeechEngine | null {
  const synthesis = typeof window === "undefined" ? undefined : window.speechSynthesis;
  if (!synthesis || typeof SpeechSynthesisUtterance === "undefined") return null;
  const pageLanguage =
    input.pageLanguage ?? (document.documentElement.lang || navigator.language || "en");
  return {
    remote: false,
    prepare: (chunk) => ({
      release: () => undefined,
      play: async (events, signal) => {
        // A chosen voice is picked from the device's list, which is empty until the device reports it.
        if (input.voiceURI !== null || getVoiceChatStyle() === "conqueror") {
          await waitForVoices(synthesis, signal);
        }
        if (signal.aborted) throw abortError();
        await new Promise<void>((resolve, reject) => {
          let finished = false;
          let began = false;
          let active: SpeechSynthesisUtterance | null = null;
          const timers: number[] = [];
          const clear = () => {
            for (const timer of timers.splice(0)) window.clearTimeout(timer);
          };
          const settle = (error?: Error) => {
            if (finished) return;
            finished = true;
            clear();
            signal.removeEventListener("abort", onAbort);
            if (error) reject(error);
            else resolve();
          };
          const onAbort = () => {
            active = null;
            synthesis.cancel();
            settle(abortError());
          };
          signal.addEventListener("abort", onAbort);
          const speak = (retried: boolean) => {
            clear();
            const said = spokenForm(chunk.text);
            const utterance = new SpeechSynthesisUtterance(said);
            const language = replyLanguage(chunk.text, pageLanguage);
            utterance.lang = language;
            const voices = synthesis.getVoices();
            const voice = pickSystemVoice(voices, language, input.voiceURI);
            if (voice) utterance.voice = voice;
            const picked = input.voiceURI !== null && voice?.voiceURI === input.voiceURI;
            applyVoiceChatStyle(utterance, voices, getVoiceChatStyle(), picked);
            utterance.rate *= input.rate;
            // The length-based deadline counts from the moment the engine begins, not from the hand-over.
            const begin = () => {
              if (finished || began || active !== utterance) return;
              began = true;
              clear();
              events.onStart();
              timers.push(window.setTimeout(() => settle(), speechDeadlineMs(chunk.text)));
            };
            utterance.onstart = begin;
            utterance.onboundary = (event) => {
              if (active !== utterance) return;
              begin();
              // Progress is reported against the chunk as written, not the stops added for the voice.
              events.onProgress(Math.round((event.charIndex * chunk.text.length) / said.length));
            };
            utterance.onend = () => {
              if (active === utterance) settle();
            };
            // An engine error skips this stretch; the reading goes on with the next one.
            utterance.onerror = () => {
              if (active === utterance) settle();
            };
            active = utterance;
            // A stale queue (or a paused engine) would hold this utterance back.
            synthesis.cancel();
            synthesis.speak(utterance);
            // Some engines drop an utterance without any event. Idle and never started means it is not coming.
            timers.push(
              window.setTimeout(() => {
                if (began) return;
                if (synthesis.speaking) begin();
                else if (!synthesis.pending) settle();
              }, SPEECH_START_MS),
            );
            // An engine that keeps the utterance queued and never starts it gets one more try.
            timers.push(
              window.setTimeout(() => {
                if (began) return;
                if (synthesis.speaking) {
                  begin();
                  return;
                }
                if (retried || !synthesis.pending) {
                  settle();
                  return;
                }
                active = null;
                synthesis.cancel();
                speak(true);
              }, SPEECH_ENGINE_START_MS),
            );
          };
          speak(false);
        });
      },
    }),
  };
}

const AUDIO_TYPES = { mp3: "audio/mpeg", wav: "audio/wav" } as const;

/**
 * A cloud voice: each chunk is fetched as audio and played in a media element. Fetching starts
 * when the chunk is prepared, so the next one downloads while the current one plays.
 */
export function createCloudEngine(input: {
  readonly synthesize: (text: string, signal: AbortSignal) => Promise<Uint8Array>;
  readonly format: keyof typeof AUDIO_TYPES;
  readonly rate: number;
}): SpeechEngine {
  return {
    remote: true,
    prepare: (chunk) => {
      const controller = new AbortController();
      const audio = input
        .synthesize(spokenForm(chunk.text), controller.signal)
        .then((bytes) =>
          URL.createObjectURL(
            new Blob([bytes as Uint8Array<ArrayBuffer>], { type: AUDIO_TYPES[input.format] }),
          ),
        );
      // A chunk that is released before it plays must not report an unhandled failure.
      audio.catch(() => undefined);
      let url: string | null = null;
      return {
        release: () => {
          controller.abort();
          void audio.then(
            (created) => URL.revokeObjectURL(created),
            () => undefined,
          );
          if (url) URL.revokeObjectURL(url);
        },
        play: async (events, signal) => {
          url = await audio;
          if (signal.aborted) throw abortError();
          const element = new Audio(url);
          element.playbackRate = input.rate;
          await new Promise<void>((resolve, reject) => {
            const cleanup = () => {
              signal.removeEventListener("abort", onAbort);
              element.onplaying = null;
              element.ontimeupdate = null;
              element.onended = null;
              element.onerror = null;
            };
            const onAbort = () => {
              cleanup();
              element.pause();
              reject(abortError());
            };
            signal.addEventListener("abort", onAbort);
            element.onplaying = () => events.onStart();
            element.ontimeupdate = () => {
              if (!Number.isFinite(element.duration) || element.duration <= 0) return;
              events.onProgress(
                Math.round((element.currentTime / element.duration) * chunk.text.length),
              );
            };
            element.onended = () => {
              cleanup();
              events.onProgress(chunk.text.length);
              resolve();
            };
            element.onerror = () => {
              cleanup();
              reject(new Error("The cloud voice returned audio this device cannot play."));
            };
            element.play().catch((error: unknown) => {
              cleanup();
              reject(error instanceof Error ? error : new Error(String(error)));
            });
          });
        },
      };
    },
  };
}

export type SpeechPlaybackHandlers = Readonly<{
  /** A chunk began playing. */
  onChunkStart?: (chunk: SpeechChunk) => void;
  /** The voice reached this offset in the whole text. */
  onProgress?: (offset: number) => void;
  /** The cloud voice failed; the rest is read with the device voice. Called once. */
  onFallback?: (error: unknown) => void;
}>;

export type SpeechPlayback = Readonly<{
  /**
   * Everything that can be read so far (see `settledMarkdown` for a reply that is still being
   * written); `final` means no more will come. Text already given must not change.
   */
  update: (text: string, final: boolean) => void;
  stop: () => void;
  /** Settles once everything was read ("finished") or reading was stopped ("stopped"). */
  done: Promise<"finished" | "stopped">;
}>;

/** How many chunks ahead are prepared while one plays. */
const LOOKAHEAD = 2;

/** Reads text aloud a chunk at a time, in order. More text may keep arriving while it reads. */
export function startSpeech(
  primary: SpeechEngine,
  fallback: SpeechEngine | null,
  handlers: SpeechPlaybackHandlers = {},
): SpeechPlayback {
  const controller = new AbortController();
  type Queued = { chunk: SpeechChunk; prepared: PreparedChunk | null };
  const queue: Queued[] = [];
  let engine = primary;
  let fellBack = false;
  let consumed = 0;
  let consumedText = "";
  let final = false;
  let wake: (() => void) | null = null;
  const signalWake = () => {
    wake?.();
    wake = null;
  };

  const prepareAhead = () => {
    for (const item of queue.slice(0, LOOKAHEAD + 1)) item.prepared ??= engine.prepare(item.chunk);
  };

  const update = (text: string, isFinal: boolean) => {
    if (controller.signal.aborted || final) return;
    // Earlier text changed (a reply reformatted itself): what was already queued stays as it was.
    const base = text.startsWith(consumedText) ? consumed : Math.min(consumed, text.length);
    const fresh = text.slice(base);
    const chunks = speechChunks(fresh, { firstAlone: engine.remote && consumed === 0 }).map(
      (chunk) => ({ ...chunk, start: chunk.start + base }),
    );
    for (const chunk of chunks) queue.push({ chunk, prepared: null });
    const last = chunks.at(-1);
    if (last) {
      consumed = last.start + last.text.length;
      consumedText = text.slice(0, consumed);
    }
    if (isFinal) final = true;
    prepareAhead();
    signalWake();
  };

  const run = async (): Promise<"finished" | "stopped"> => {
    for (;;) {
      if (controller.signal.aborted) return "stopped";
      const item = queue[0];
      if (!item) {
        if (final) return "finished";
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        continue;
      }
      prepareAhead();
      const prepared = item.prepared ?? engine.prepare(item.chunk);
      try {
        await prepared.play(
          {
            onStart: () => handlers.onChunkStart?.(item.chunk),
            onProgress: (charIndex) => handlers.onProgress?.(item.chunk.start + charIndex),
          },
          controller.signal,
        );
        queue.shift();
        prepared.release();
      } catch (error) {
        prepared.release();
        if (controller.signal.aborted) return "stopped";
        if (fallback !== null && !fellBack && engine !== fallback) {
          fellBack = true;
          engine = fallback;
          for (const queued of queue) {
            queued.prepared?.release();
            queued.prepared = null;
          }
          handlers.onFallback?.(error);
          continue;
        }
        // Nothing left to fall back on: skip this stretch rather than stall the reading.
        queue.shift();
      }
    }
  };

  const done = run().finally(() => {
    for (const item of queue.splice(0)) item.prepared?.release();
  });

  return {
    update,
    stop: () => {
      controller.abort();
      signalWake();
    },
    done,
  };
}

/** The one reading that may be playing; starting another stops it. */
let current: SpeechPlayback | null = null;

/** Starts a reading as the only one, stopping any reading before it. */
export function claimSpeech(playback: SpeechPlayback): SpeechPlayback {
  if (current !== null && current !== playback) current.stop();
  current = playback;
  void playback.done.finally(() => {
    if (current === playback) current = null;
  });
  return playback;
}
