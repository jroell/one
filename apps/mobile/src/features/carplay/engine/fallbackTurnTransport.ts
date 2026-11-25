import { msg } from "gt-react-native";

import { m } from "../../../i18n/messages";
import { base64ToBytes, bytesToBase64, computePcm16Base64Rms } from "./pcmAudio";
import { sanitizeForSpeech } from "./personas";
import type {
  ApiKeyProvider,
  CarPlayNativeAdapter,
  RealtimeTransport,
  TransportCallbacks,
  TransportSessionConfig,
  VoiceProvider,
} from "./types";

export interface FallbackTurnTransportOptions {
  readonly provider: Extract<VoiceProvider, "elevenlabs" | "on-device">;
  readonly native: CarPlayNativeAdapter;
  readonly getApiKey: (provider: ApiKeyProvider) => Promise<string | null>;
  readonly elevenLabsCustomVoiceId?: string;
  readonly transcribePcm?: (pcm24kBytes: Uint8Array) => Promise<string | null>;
  readonly fetchImpl?: typeof fetch;
}

interface ConversationMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
}

function buildWavFromPcm16(pcmBytes: Uint8Array, sampleRate: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeAscii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + pcmBytes.byteLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, pcmBytes.byteLength, true);

  const out = new Uint8Array(44 + pcmBytes.byteLength);
  out.set(new Uint8Array(header), 0);
  out.set(pcmBytes, 44);
  return out;
}

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
  readonly #transcribePcm?: (pcm24kBytes: Uint8Array) => Promise<string | null>;
  readonly #fetch: typeof fetch;

  #config: TransportSessionConfig | null = null;
  #callbacks: TransportCallbacks | null = null;
  #connected = false;
  #speaking = false;
  #processing = false;
  #activeAbort: AbortController | null = null;
  #history: Array<ConversationMessage> = [];
  #speechChunks: Array<Uint8Array> = [];
  #detectedSpeech = false;
  #silentChunkCount = 0;

  constructor(options: FallbackTurnTransportOptions) {
    this.provider = options.provider;
    this.#native = options.native;
    this.#getApiKey = options.getApiKey;
    this.#elevenLabsCustomVoiceId = options.elevenLabsCustomVoiceId?.trim() ?? "";
    this.#transcribePcm = options.transcribePcm;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async connect(config: TransportSessionConfig, callbacks: TransportCallbacks): Promise<void> {
    this.#config = config;
    this.#callbacks = callbacks;
    this.#connected = true;
    this.#history = [];
    this.#resetCaptureBuffer();

    callbacks.onConnected();
    callbacks.onStateChange("listening");
  }

  sendAudioChunk(pcm24kBase64: string, _sampleRate: number): void {
    if (!this.#connected || !pcm24kBase64 || !this.#config) return;
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
      this.#speechChunks.push(base64ToBytes(pcm24kBase64));
      return;
    }

    if (this.#detectedSpeech) {
      this.#speechChunks.push(base64ToBytes(pcm24kBase64));
      this.#silentChunkCount += 1;
      // Roughly 700ms of trailing silence (7 x 100ms chunks) commits the spoken turn.
      if (this.#silentChunkCount >= 7) {
        const audio = concatUint8Arrays(this.#speechChunks);
        this.#resetCaptureBuffer();
        void this.#handleSpokenAudioTurn(audio);
      }
    }
  }

  sendTextTurn(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || !this.#connected) return;
    void this.#processUserText(trimmed);
  }

  interrupt(): void {
    this.#activeAbort?.abort();
    this.#activeAbort = null;
    this.#speaking = false;
    this.#processing = false;
    this.#resetCaptureBuffer();
    void this.#native.stopFallbackSpeech();
    void this.#native.clearPlaybackQueue();
    this.#callbacks?.onBargeIn();
    this.#callbacks?.onStateChange("interrupted");
    this.#callbacks?.onStateChange("listening");
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
    this.#activeAbort?.abort();
    this.#activeAbort = null;
    this.#speaking = false;
    this.#processing = false;
    this.#resetCaptureBuffer();
    await this.#native.stopFallbackSpeech();
    await this.#native.clearPlaybackQueue();
  }

  #resetCaptureBuffer(): void {
    this.#speechChunks = [];
    this.#detectedSpeech = false;
    this.#silentChunkCount = 0;
  }

  async #handleSpokenAudioTurn(pcm24kBytes: Uint8Array): Promise<void> {
    if (!this.#connected || pcm24kBytes.byteLength < 2_400) return;
    this.#processing = true;
    this.#callbacks?.onStateChange("thinking");

    try {
      const transcript = await this.#transcribeAudio(pcm24kBytes);
      if (!transcript || !this.#connected) {
        this.#processing = false;
        this.#callbacks?.onStateChange("listening");
        return;
      }
      await this.#processUserText(transcript);
    } catch {
      this.#processing = false;
      this.#callbacks?.onStateChange("listening");
    }
  }

  async #transcribeAudio(pcm24kBytes: Uint8Array): Promise<string | null> {
    if (this.#transcribePcm) {
      return this.#transcribePcm(pcm24kBytes);
    }
    const openAiKey = await this.#getApiKey("openai");
    if (!openAiKey) return null;

    const wavBytes = buildWavFromPcm16(pcm24kBytes, 24_000);
    const wavBuffer = new ArrayBuffer(wavBytes.byteLength);
    new Uint8Array(wavBuffer).set(wavBytes);
    const form = new FormData();
    const blob = new Blob([wavBuffer], { type: "audio/wav" });
    form.append("file", blob, "turn.wav");
    form.append("model", "gpt-4o-mini-transcribe");

    const response = await this.#fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
      },
      body: form,
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { readonly text?: unknown };
    return typeof json.text === "string" && json.text.trim().length > 0 ? json.text.trim() : null;
  }

  async #processUserText(userText: string): Promise<void> {
    if (!this.#connected || !this.#config || !this.#callbacks) return;

    this.#activeAbort?.abort();
    const controller = new AbortController();
    this.#activeAbort = controller;
    this.#processing = true;

    this.#callbacks.onUserTranscript(userText, true);
    this.#callbacks.onStateChange("thinking");
    this.#history.push({ role: "user", text: userText });
    if (this.#history.length > 12) {
      this.#history = this.#history.slice(-12);
    }

    try {
      const reply = await this.#generateReply(userText, controller.signal);
      if (controller.signal.aborted || !this.#connected) return;

      const spokenReply = sanitizeForSpeech(reply);
      this.#history.push({ role: "assistant", text: spokenReply });
      this.#callbacks.onAssistantTranscript(spokenReply, true);
      this.#processing = false;

      await this.#speakReply(spokenReply, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        const message =
          error instanceof Error ? error.message : "Could not complete the voice turn.";
        this.#callbacks.onError(message, true);
      }
    } finally {
      this.#processing = false;
      this.#speaking = false;
      if (this.#connected) {
        this.#callbacks.onStateChange("listening");
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

    const openAiKey = await this.#getApiKey("openai");
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

    const geminiKey = await this.#getApiKey("gemini");
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

    return m(
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
    if (lower.includes("approval") || lower.includes("approve")) {
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
