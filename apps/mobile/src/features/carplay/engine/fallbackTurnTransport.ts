import { msg } from "gt-react-native";

import { m } from "../../../i18n/messages";
import { base64ToBytes, bytesToBase64, computePcm16Base64Rms } from "./pcmAudio";
import { sanitizeForSpeech } from "./personas";
import { createOpenAiPcmTranscriber, type PcmTranscriber } from "./speechInput";
import type {
  ApiKeyProvider,
  CarPlayNativeAdapter,
  RealtimeTransport,
  TransportCallbacks,
  TransportSessionConfig,
  VoiceProvider,
} from "./types";

/** One spoken turn is cut off at this length: a stuck loud room must not grow the buffer forever. */
const MAX_UTTERANCE_SECONDS = 20;
/** 24 kHz mono PCM16, so the duration cap and the byte cap are the same limit. */
const MAX_UTTERANCE_BYTES = MAX_UTTERANCE_SECONDS * 24_000 * 2;

export interface FallbackTurnTransportOptions {
  readonly provider: Extract<VoiceProvider, "elevenlabs" | "on-device">;
  readonly native: CarPlayNativeAdapter;
  readonly getApiKey: (provider: ApiKeyProvider) => Promise<string | null>;
  readonly elevenLabsCustomVoiceId?: string;
  /** Speech-to-text for one utterance. When set it is the only recognizer used. */
  readonly transcribePcm?: PcmTranscriber;
  /** The phone's own recognizer, resolved once when the session connects. */
  readonly getLocalTranscriber?: (signal: AbortSignal) => Promise<PcmTranscriber | null>;
  readonly fetchImpl?: typeof fetch;
}

interface ConversationMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
}

const APPROVE_OR_DECLINE_INTENT = /\b(approve|accept|decline|deny|reject)\b/;

function concatUint8Arrays(chunks: ReadonlyArray<Uint8Array>): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

export class FallbackTurnTransport implements RealtimeTransport {
  readonly provider: Extract<VoiceProvider, "elevenlabs" | "on-device">;

  readonly #native: CarPlayNativeAdapter;
  readonly #getApiKey: (provider: ApiKeyProvider) => Promise<string | null>;
  readonly #elevenLabsCustomVoiceId: string;
  readonly #injectedTranscriber?: PcmTranscriber;
  readonly #getLocalTranscriber?: (signal: AbortSignal) => Promise<PcmTranscriber | null>;
  readonly #fetch: typeof fetch;

  #config: TransportSessionConfig | null = null;
  #callbacks: TransportCallbacks | null = null;
  #connected = false;
  #speaking = false;
  #processing = false;
  /** Null when this session cannot hear the driver; typed turns still work. */
  #transcriber: PcmTranscriber | null = null;
  #activeAbort: AbortController | null = null;
  #setupAbort: AbortController | null = null;
  #turnSeq = 0;
  #history: Array<ConversationMessage> = [];
  #speechChunks: Array<Uint8Array> = [];
  #speechBytes = 0;
  #detectedSpeech = false;
  #silentChunkCount = 0;

  constructor(options: FallbackTurnTransportOptions) {
    this.provider = options.provider;
    this.#native = options.native;
    this.#getApiKey = options.getApiKey;
    this.#elevenLabsCustomVoiceId = options.elevenLabsCustomVoiceId?.trim() ?? "";
    this.#injectedTranscriber = options.transcribePcm;
    this.#getLocalTranscriber = options.getLocalTranscriber;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async connect(config: TransportSessionConfig, callbacks: TransportCallbacks): Promise<void> {
    this.#config = config;
    this.#callbacks = callbacks;
    this.#history = [];
    this.#resetCaptureBuffer();
    const setup = new AbortController();
    this.#setupAbort = setup;

    const { transcriber, unavailableMessage } = await this.#resolveTranscriber(setup.signal);
    if (setup.signal.aborted) return;
    this.#transcriber = transcriber;
    this.#connected = true;

    callbacks.onConnected();
    if (transcriber) {
      callbacks.onStateChange("listening");
    } else {
      callbacks.onStateChange("idle");
      callbacks.onInputUnavailable?.(unavailableMessage);
    }
  }

  /**
   * On-Device never sends microphone audio off the phone, whatever keys are saved. A cloud voice
   * (ElevenLabs) falls back to OpenAI transcription only when the driver saved an OpenAI key.
   */
  async #resolveTranscriber(
    signal: AbortSignal,
  ): Promise<{ transcriber: PcmTranscriber | null; unavailableMessage: string }> {
    if (this.#injectedTranscriber) {
      return { transcriber: this.#injectedTranscriber, unavailableMessage: "" };
    }
    let localFailure: string | null = null;
    if (this.#getLocalTranscriber) {
      try {
        const local = await this.#getLocalTranscriber(signal);
        if (local) return { transcriber: local, unavailableMessage: "" };
      } catch (error) {
        localFailure = error instanceof Error ? error.message : null;
      }
    }
    if (this.provider === "elevenlabs") {
      const openAiKey = await this.#getApiKey("openai");
      if (openAiKey) {
        return {
          transcriber: createOpenAiPcmTranscriber({ apiKey: openAiKey, fetchImpl: this.#fetch }),
          unavailableMessage: "",
        };
      }
      return {
        transcriber: null,
        unavailableMessage: m(
          msg("This voice needs an OpenAI key to hear you. Add one in setup, or type."),
        ),
      };
    }
    return {
      transcriber: null,
      unavailableMessage:
        localFailure ??
        m(
          msg(
            "On-Device voice cannot hear you on this phone. Add a cloud voice key in setup, or type.",
          ),
        ),
    };
  }

  sendAudioChunk(pcm24kBase64: string, _sampleRate: number): void {
    if (!this.#connected || !this.#transcriber || !pcm24kBase64 || !this.#config) return;
    const rms = computePcm16Base64Rms(pcm24kBase64);
    const threshold =
      this.#config.bargeInSensitivity === "high"
        ? 0.035
        : this.#config.bargeInSensitivity === "low"
          ? 0.09
          : 0.055;

    if (this.#speaking) {
      if (this.#config.bargeInEnabled && rms >= threshold * 1.4) {
        this.interrupt();
      }
      return;
    }

    if (this.#processing) return;

    if (rms >= threshold) {
      this.#detectedSpeech = true;
      this.#silentChunkCount = 0;
      this.#pushSpeechChunk(base64ToBytes(pcm24kBase64));
      return;
    }

    if (this.#detectedSpeech) {
      this.#pushSpeechChunk(base64ToBytes(pcm24kBase64));
      this.#silentChunkCount += 1;
      // Roughly 700ms of trailing silence (7 x 100ms chunks) commits the spoken turn.
      if (this.#silentChunkCount >= 7) {
        this.#commitSpeech();
      }
    }
  }

  #pushSpeechChunk(bytes: Uint8Array): void {
    this.#speechChunks.push(bytes);
    this.#speechBytes += bytes.byteLength;
    if (this.#speechBytes >= MAX_UTTERANCE_BYTES) {
      this.#commitSpeech();
    }
  }

  #commitSpeech(): void {
    const audio = concatUint8Arrays(this.#speechChunks);
    this.#resetCaptureBuffer();
    void this.#handleSpokenAudioTurn(audio);
  }

  sendTextTurn(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || !this.#connected) return;
    void this.#runTurn(async () => trimmed);
  }

  interrupt(): void {
    this.#turnSeq += 1;
    this.#activeAbort?.abort();
    this.#activeAbort = null;
    this.#speaking = false;
    this.#processing = false;
    this.#resetCaptureBuffer();
    void this.#native.stopFallbackSpeech();
    void this.#native.clearPlaybackQueue();
    this.#callbacks?.onBargeIn();
    this.#callbacks?.onStateChange("interrupted");
    this.#callbacks?.onStateChange(this.#restingState());
  }

  async updateSession(patch: Partial<TransportSessionConfig>): Promise<void> {
    if (!this.#config) return;
    this.#config = {
      ...this.#config,
      ...patch,
    };
  }

  async disconnect(): Promise<void> {
    this.#connected = false;
    this.#turnSeq += 1;
    this.#setupAbort?.abort();
    this.#setupAbort = null;
    this.#activeAbort?.abort();
    this.#activeAbort = null;
    this.#speaking = false;
    this.#processing = false;
    this.#resetCaptureBuffer();
    await this.#native.stopFallbackSpeech();
    await this.#native.clearPlaybackQueue();
  }

  #restingState(): "listening" | "idle" {
    return this.#transcriber ? "listening" : "idle";
  }

  #resetCaptureBuffer(): void {
    this.#speechChunks = [];
    this.#speechBytes = 0;
    this.#detectedSpeech = false;
    this.#silentChunkCount = 0;
  }

  async #handleSpokenAudioTurn(pcm24kBytes: Uint8Array): Promise<void> {
    const transcribe = this.#transcriber;
    if (!this.#connected || !transcribe || pcm24kBytes.byteLength < 2_400) return;
    await this.#runTurn((signal) => transcribe(pcm24kBytes, signal));
  }

  /**
   * One user turn from input to the end of the spoken reply. A newer turn, an interrupt or a
   * disconnect supersedes it, and a superseded turn leaves the shared flags alone.
   */
  async #runTurn(getUserText: (signal: AbortSignal) => Promise<string | null>): Promise<void> {
    const callbacks = this.#callbacks;
    if (!this.#connected || !this.#config || !callbacks) return;

    this.#activeAbort?.abort();
    const controller = new AbortController();
    this.#activeAbort = controller;
    const turnId = ++this.#turnSeq;
    const superseded = () =>
      turnId !== this.#turnSeq || controller.signal.aborted || !this.#connected;
    this.#processing = true;
    callbacks.onStateChange("thinking");

    try {
      const userText = await getUserText(controller.signal);
      if (superseded() || !userText) return;

      callbacks.onUserTranscript(userText, true);
      this.#history.push({ role: "user", text: userText });
      if (this.#history.length > 12) {
        this.#history = this.#history.slice(-12);
      }

      const reply = await this.#generateReply(userText, controller.signal);
      if (superseded()) return;

      const spokenReply = sanitizeForSpeech(reply);
      this.#history.push({ role: "assistant", text: spokenReply });
      callbacks.onAssistantTranscript(spokenReply, true);
      this.#processing = false;

      await this.#speakReply(spokenReply, controller.signal);
    } catch (error) {
      if (!superseded()) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : m(msg("Could not complete the voice turn."));
        callbacks.onError(message, true);
      }
    } finally {
      if (turnId === this.#turnSeq) {
        this.#processing = false;
        this.#speaking = false;
        if (this.#connected) {
          callbacks.onStateChange(this.#restingState());
        }
      }
    }
  }

  async #generateReply(userText: string, signal: AbortSignal): Promise<string> {
    const config = this.#config!;

    // Handle direct Agent Bridge intents locally so linked thread queries work even with zero keys.
    const bridgeReply = await this.#tryLocalAgentBridgeIntent(userText);
    if (bridgeReply !== null) {
      return bridgeReply;
    }

    // On-Device keeps everything on the phone: no transcript goes to a cloud model.
    const useCloudModels = this.provider !== "on-device";
    const openAiKey = useCloudModels ? await this.#getApiKey("openai") : null;
    if (openAiKey) {
      const response = await this.#fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openAiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: config.instructions },
            ...this.#history.map((msg) => ({ role: msg.role, content: msg.text })),
          ],
          max_tokens: 180,
        }),
        signal,
      });
      if (response.ok) {
        const data = (await response.json()) as {
          readonly choices?: ReadonlyArray<{ readonly message?: { readonly content?: string } }>;
        };
        const content = data.choices?.[0]?.message?.content?.trim();
        if (content) return content;
      }
    }

    const geminiKey = useCloudModels ? await this.#getApiKey("gemini") : null;
    if (geminiKey) {
      const response = await this.#fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: config.instructions }] },
            contents: this.#history.map((msg) => ({
              role: msg.role === "assistant" ? "model" : "user",
              parts: [{ text: msg.text }],
            })),
          }),
          signal,
        },
      );
      if (response.ok) {
        const data = (await response.json()) as {
          readonly candidates?: ReadonlyArray<{
            readonly content?: { readonly parts?: ReadonlyArray<{ readonly text?: string }> };
          }>;
        };
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (content) return content;
      }
    }

    return this.provider === "on-device"
      ? m(
          msg(
            'On-Device Drive Mode heard you say: "{userText}". It can answer questions about your linked One threads. Pick a cloud voice with an API key in Voice Setup for open conversation.',
          ),
          { userText },
        )
      : m(
          msg(
            'On-Device Drive Mode heard you say: "{userText}". Add an OpenAI or Gemini API key in Voice Setup for full conversational AI, or ask me about your linked One threads anytime.',
          ),
          { userText },
        );
  }

  async #tryLocalAgentBridgeIntent(userText: string): Promise<string | null> {
    if (!this.#callbacks?.onToolCall || !this.#config || this.#config.tools.length === 0) {
      return null;
    }
    const lower = userText.toLowerCase();
    if (APPROVE_OR_DECLINE_INTENT.test(lower)) {
      // Approvals are never answered by voice; the bridge replies with where to do it.
      const res = await this.#callbacks.onToolCall("respond_to_approval", {});
      return res.spokenSummary;
    }
    if (lower.includes("approval")) {
      const res = await this.#callbacks.onToolCall("list_pending_approvals", {});
      return res.spokenSummary;
    }
    if (lower.includes("thread") || lower.includes("status") || lower.includes("agent")) {
      const res = await this.#callbacks.onToolCall("list_active_threads", {});
      return res.spokenSummary;
    }
    return null;
  }

  async #speakReply(text: string, signal: AbortSignal): Promise<void> {
    if (!text || signal.aborted || !this.#config || !this.#callbacks) return;
    this.#speaking = true;
    this.#callbacks.onStateChange("speaking");

    if (this.provider === "elevenlabs") {
      const apiKey = await this.#getApiKey("elevenlabs");
      if (apiKey) {
        const voiceId = this.#elevenLabsCustomVoiceId || this.#config.voice.providerVoiceId;
        const response = await this.#fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=pcm_24000`,
          {
            method: "POST",
            headers: {
              "xi-api-key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              text,
              model_id: "eleven_flash_v2_5",
            }),
            signal,
          },
        );
        if (response.ok) {
          const pcmBuffer = await response.arrayBuffer();
          if (!signal.aborted && pcmBuffer.byteLength > 0) {
            this.#callbacks.onAudioDelta(bytesToBase64(new Uint8Array(pcmBuffer)), 24_000);
            return;
          }
        }
      }
    }

    if (!signal.aborted) {
      await this.#native.speakFallbackText(text, {
        rate: this.#config.spokenSpeed,
        voiceId: this.#config.voice.id,
      });
    }
  }
}
