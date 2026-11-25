import { pcm16Base64ToResampledBase64 } from "./pcmAudio";
import {
  DEFAULT_GEMINI_LIVE_MODEL,
  type RealtimeTransport,
  type TransportCallbacks,
  type TransportSessionConfig,
  type VoiceToolDefinition,
  type WebSocketFactory,
  type WebSocketLike,
} from "./types";

const GEMINI_LIVE_WS_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const GEMINI_INPUT_SAMPLE_RATE = 16_000;
const GEMINI_DEFAULT_OUTPUT_SAMPLE_RATE = 24_000;
const WS_OPEN = 1;

export interface GeminiLiveTransportOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly webSocketFactory?: WebSocketFactory;
}

function defaultWebSocketFactory(url: string): WebSocketLike {
  return new WebSocket(url) as unknown as WebSocketLike;
}

function normalizeGeminiModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return DEFAULT_GEMINI_LIVE_MODEL;
  return trimmed.startsWith("models/") ? trimmed : `models/${trimmed}`;
}

function mapToolsForGemini(tools: ReadonlyArray<VoiceToolDefinition>) {
  if (tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    },
  ];
}

function buildGeminiSetupPayload(model: string, config: TransportSessionConfig) {
  const tools = mapToolsForGemini(config.tools);
  return {
    setup: {
      model: normalizeGeminiModel(model),
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: config.voice.providerVoiceId,
            },
          },
        },
      },
      systemInstruction: {
        parts: [{ text: config.instructions }],
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      ...(tools ? { tools } : {}),
    },
  };
}

function parseMimeSampleRate(mimeType: string): number {
  const match = /rate=(\d+)/i.exec(mimeType);
  if (!match?.[1]) return GEMINI_DEFAULT_OUTPUT_SAMPLE_RATE;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : GEMINI_DEFAULT_OUTPUT_SAMPLE_RATE;
}

export class GeminiLiveTransport implements RealtimeTransport {
  readonly provider = "gemini-live" as const;

  readonly #apiKey: string;
  readonly #model: string;
  readonly #webSocketFactory: WebSocketFactory;

  #ws: WebSocketLike | null = null;
  #config: TransportSessionConfig | null = null;
  #callbacks: TransportCallbacks | null = null;
  #setupReady = false;
  #assistantTranscript = "";
  #userTranscript = "";
  #assistantSpeaking = false;
  #closingIntentionally = false;

  constructor(options: GeminiLiveTransportOptions) {
    this.#apiKey = options.apiKey;
    this.#model = normalizeGeminiModel(options.model ?? DEFAULT_GEMINI_LIVE_MODEL);
    this.#webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory;
  }

  async connect(config: TransportSessionConfig, callbacks: TransportCallbacks): Promise<void> {
    this.#config = config;
    this.#callbacks = callbacks;
    this.#setupReady = false;
    this.#assistantTranscript = "";
    this.#userTranscript = "";
    this.#assistantSpeaking = false;
    this.#closingIntentionally = false;

    const url = `${GEMINI_LIVE_WS_BASE}?key=${encodeURIComponent(this.#apiKey)}`;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = this.#webSocketFactory(url);
      this.#ws = ws;

      ws.onopen = () => {
        this.#sendJson(buildGeminiSetupPayload(this.#model, config));
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      ws.onmessage = (event) => {
        this.#handleServerMessage(event.data);
      };

      ws.onerror = () => {
        // Never include URL or key in errors.
        const message = "Gemini Live connection error.";
        if (!settled) {
          settled = true;
          reject(new Error(message));
          return;
        }
        callbacks.onError(message, true);
      };

      ws.onclose = (event) => {
        const reason = event.reason || `Closed (${event.code ?? 1000})`;
        const unexpected = !this.#closingIntentionally;
        if (!settled) {
          settled = true;
          reject(new Error(`Gemini Live closed before connecting: ${reason}`));
          return;
        }
        this.#ws = null;
        this.#setupReady = false;
        this.#assistantSpeaking = false;
        callbacks.onClose(reason, unexpected);
      };
    });
  }

  sendAudioChunk(pcmBase64: string, sampleRate: number): void {
    if (!pcmBase64 || !this.#isOpen() || !this.#setupReady) return;
    const pcm16k =
      sampleRate === GEMINI_INPUT_SAMPLE_RATE
        ? pcmBase64
        : pcm16Base64ToResampledBase64(pcmBase64, sampleRate, GEMINI_INPUT_SAMPLE_RATE);

    this.#sendJson({
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: `audio/pcm;rate=${GEMINI_INPUT_SAMPLE_RATE}`,
            data: pcm16k,
          },
        ],
      },
    });
  }

  sendTextTurn(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || !this.#isOpen() || !this.#setupReady) return;
    this.#callbacks?.onUserTranscript(trimmed, true);
    this.#callbacks?.onStateChange("thinking");
    this.#sendJson({
      clientContent: {
        turns: [
          {
            role: "user",
            parts: [{ text: trimmed }],
          },
        ],
        turnComplete: true,
      },
    });
  }

  interrupt(): void {
    this.#assistantSpeaking = false;
    this.#assistantTranscript = "";
    this.#callbacks?.onBargeIn();
    if (this.#isOpen() && this.#setupReady) {
      // Sending an empty turnComplete interrupts ongoing generation cleanly on Gemini Live.
      this.#sendJson({
        clientContent: {
          turns: [],
          turnComplete: true,
        },
      });
    }
  }

  async updateSession(patch: Partial<TransportSessionConfig>): Promise<void> {
    if (!this.#config || !this.#callbacks) return;
    const prevVoiceId = this.#config.voice.providerVoiceId;
    const merged: TransportSessionConfig = {
      ...this.#config,
      ...patch,
    };
    this.#config = merged;

    // Gemini Live pins voiceName inside the initial setup handshake, so voice switches reconnect cleanly.
    if (merged.voice.providerVoiceId !== prevVoiceId && this.#ws) {
      const callbacks = this.#callbacks;
      await this.disconnect();
      await this.connect(merged, callbacks);
    }
  }

  async disconnect(): Promise<void> {
    this.#closingIntentionally = true;
    this.#setupReady = false;
    this.#assistantSpeaking = false;
    const ws = this.#ws;
    this.#ws = null;
    if (ws) {
      try {
        ws.close(1000, "Session ended");
      } catch {
        // Ignore teardown close errors.
      }
    }
  }

  #isOpen(): boolean {
    return this.#ws !== null && this.#ws.readyState === WS_OPEN;
  }

  #sendJson(payload: unknown): void {
    if (!this.#isOpen() || !this.#ws) return;
    this.#ws.send(JSON.stringify(payload));
  }

  #handleServerMessage(rawData: unknown): void {
    if (typeof rawData !== "string") return;
    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawData);
      if (!parsed || typeof parsed !== "object") return;
      payload = parsed as Record<string, unknown>;
    } catch {
      return;
    }

    const callbacks = this.#callbacks;
    if (!callbacks) return;

    if ("setupComplete" in payload) {
      this.#setupReady = true;
      callbacks.onConnected();
      callbacks.onStateChange("listening");
      return;
    }

    if (payload.toolCall && typeof payload.toolCall === "object") {
      void this.#handleToolCall(payload.toolCall as Record<string, unknown>);
      return;
    }

    if (payload.serverContent && typeof payload.serverContent === "object") {
      const content = payload.serverContent as Record<string, unknown>;

      if (content.interrupted === true) {
        this.#assistantSpeaking = false;
        this.#assistantTranscript = "";
        callbacks.onBargeIn();
        callbacks.onStateChange("interrupted");
        callbacks.onStateChange("listening");
        return;
      }

      if (content.inputTranscription && typeof content.inputTranscription === "object") {
        const text = (content.inputTranscription as Record<string, unknown>).text;
        if (typeof text === "string" && text.trim().length > 0) {
          this.#userTranscript = `${this.#userTranscript} ${text.trim()}`.trim();
          callbacks.onUserTranscript(this.#userTranscript, false);
        }
      }

      if (content.outputTranscription && typeof content.outputTranscription === "object") {
        const text = (content.outputTranscription as Record<string, unknown>).text;
        if (typeof text === "string" && text.trim().length > 0) {
          this.#assistantTranscript = `${this.#assistantTranscript} ${text.trim()}`.trim();
          callbacks.onAssistantTranscript(this.#assistantTranscript, false);
        }
      }

      if (content.modelTurn && typeof content.modelTurn === "object") {
        const parts = (content.modelTurn as Record<string, unknown>).parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            if (!part || typeof part !== "object") continue;
            const partObj = part as Record<string, unknown>;
            if (typeof partObj.text === "string" && partObj.text.trim().length > 0) {
              this.#assistantTranscript =
                `${this.#assistantTranscript} ${partObj.text.trim()}`.trim();
              callbacks.onAssistantTranscript(this.#assistantTranscript, false);
            }
            if (partObj.inlineData && typeof partObj.inlineData === "object") {
              const inline = partObj.inlineData as Record<string, unknown>;
              const mimeType = typeof inline.mimeType === "string" ? inline.mimeType : "";
              const data = typeof inline.data === "string" ? inline.data : "";
              if (mimeType.startsWith("audio/pcm") && data.length > 0) {
                if (!this.#assistantSpeaking) {
                  this.#assistantSpeaking = true;
                  callbacks.onStateChange("speaking");
                }
                const rate = parseMimeSampleRate(mimeType);
                const normalized24k =
                  rate === GEMINI_DEFAULT_OUTPUT_SAMPLE_RATE
                    ? data
                    : pcm16Base64ToResampledBase64(data, rate, GEMINI_DEFAULT_OUTPUT_SAMPLE_RATE);
                callbacks.onAudioDelta(normalized24k, GEMINI_DEFAULT_OUTPUT_SAMPLE_RATE);
              }
            }
          }
        }
      }

      if (content.turnComplete === true) {
        if (this.#userTranscript.length > 0) {
          callbacks.onUserTranscript(this.#userTranscript, true);
          this.#userTranscript = "";
        }
        if (this.#assistantTranscript.length > 0) {
          callbacks.onAssistantTranscript(this.#assistantTranscript, true);
          this.#assistantTranscript = "";
        }
        this.#assistantSpeaking = false;
        callbacks.onStateChange("listening");
      }
    }
  }

  async #handleToolCall(toolCall: Record<string, unknown>): Promise<void> {
    const calls = toolCall.functionCalls;
    if (!Array.isArray(calls) || !this.#callbacks?.onToolCall) return;

    this.#callbacks.onStateChange("thinking");
    const functionResponses: Array<Record<string, unknown>> = [];

    for (const call of calls) {
      if (!call || typeof call !== "object") continue;
      const callObj = call as Record<string, unknown>;
      const id = typeof callObj.id === "string" ? callObj.id : "";
      const name = typeof callObj.name === "string" ? callObj.name : "";
      const args =
        callObj.args && typeof callObj.args === "object"
          ? (callObj.args as Record<string, unknown>)
          : {};
      if (!name) continue;
      const result = await this.#callbacks.onToolCall(name, args);
      functionResponses.push({
        ...(id ? { id } : {}),
        name,
        response: result,
      });
    }

    if (this.#isOpen() && functionResponses.length > 0) {
      this.#sendJson({
        toolResponse: {
          functionResponses,
        },
      });
    }
  }
}
