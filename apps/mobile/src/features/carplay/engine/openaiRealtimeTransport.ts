import { pcm16Base64ToResampledBase64 } from "./pcmAudio";
import {
  DEFAULT_OPENAI_REALTIME_MODEL,
  type BargeInSensitivity,
  type RealtimeTransport,
  type TransportCallbacks,
  type TransportSessionConfig,
  type VadMode,
  type VoiceToolDefinition,
  type WebSocketFactory,
  type WebSocketLike,
} from "./types";

const OPENAI_REALTIME_WS_BASE = "wss://api.openai.com/v1/realtime";
const WS_OPEN = 1;

export interface OpenAiRealtimeTransportOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly webSocketFactory?: WebSocketFactory;
}

function defaultWebSocketFactory(
  url: string,
  options?: {
    readonly protocols?: ReadonlyArray<string>;
    readonly headers?: Readonly<Record<string, string>>;
  },
): WebSocketLike {
  // React Native's WebSocket constructor accepts headers in a 3rd options object.
  const NativeWS = WebSocket as unknown as new (
    wsUrl: string,
    protocols?: ReadonlyArray<string> | string,
    wsOptions?: { readonly headers?: Readonly<Record<string, string>> },
  ) => WebSocketLike;
  return new NativeWS(
    url,
    options?.protocols ? [...options.protocols] : undefined,
    options?.headers ? { headers: options.headers } : undefined,
  );
}

function buildTurnDetection(
  vadMode: VadMode,
  bargeInEnabled: boolean,
  sensitivity: BargeInSensitivity,
): Record<string, unknown> {
  if (vadMode === "semantic_vad") {
    const eagerness = sensitivity === "high" ? "high" : sensitivity === "low" ? "low" : "medium";
    return {
      type: "semantic_vad",
      eagerness,
      create_response: true,
      interrupt_response: bargeInEnabled,
    };
  }
  const threshold = sensitivity === "high" ? 0.35 : sensitivity === "low" ? 0.7 : 0.5;
  const silenceDurationMs = sensitivity === "high" ? 450 : sensitivity === "low" ? 800 : 600;
  return {
    type: "server_vad",
    threshold,
    prefix_padding_ms: 250,
    silence_duration_ms: silenceDurationMs,
    create_response: true,
    interrupt_response: bargeInEnabled,
  };
}

function mapToolsForOpenAi(tools: ReadonlyArray<VoiceToolDefinition>) {
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

function buildOpenAiSessionUpdatePayload(config: TransportSessionConfig) {
  return {
    type: "session.update",
    session: {
      modalities: ["audio", "text"],
      instructions: config.instructions,
      voice: config.voice.providerVoiceId,
      input_audio_format: "pcm16",
      output_audio_format: "pcm16",
      input_audio_transcription: {
        model: "gpt-4o-mini-transcribe",
      },
      turn_detection: buildTurnDetection(
        config.vadMode,
        config.bargeInEnabled,
        config.bargeInSensitivity,
      ),
      tools: mapToolsForOpenAi(config.tools),
      tool_choice: config.tools.length > 0 ? "auto" : "none",
    },
  };
}

export class OpenAiRealtimeTransport implements RealtimeTransport {
  readonly provider = "openai-realtime" as const;

  readonly #apiKey: string;
  readonly #model: string;
  readonly #webSocketFactory: WebSocketFactory;

  #ws: WebSocketLike | null = null;
  #config: TransportSessionConfig | null = null;
  #callbacks: TransportCallbacks | null = null;
  #userTranscriptBuffer = "";
  #assistantTranscriptBuffer = "";
  #assistantSpeaking = false;
  #closingIntentionally = false;

  constructor(options: OpenAiRealtimeTransportOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model?.trim() || DEFAULT_OPENAI_REALTIME_MODEL;
    this.#webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory;
  }

  async connect(config: TransportSessionConfig, callbacks: TransportCallbacks): Promise<void> {
    this.#config = config;
    this.#callbacks = callbacks;
    this.#userTranscriptBuffer = "";
    this.#assistantTranscriptBuffer = "";
    this.#assistantSpeaking = false;
    this.#closingIntentionally = false;

    const url = `${OPENAI_REALTIME_WS_BASE}?model=${encodeURIComponent(this.#model)}`;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = this.#webSocketFactory(url, {
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          "OpenAI-Beta": "realtime=v1",
        },
      });
      this.#ws = ws;

      ws.onopen = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
        this.#sendJson(buildOpenAiSessionUpdatePayload(config));
        callbacks.onConnected();
        callbacks.onStateChange("listening");
      };

      ws.onmessage = (event) => {
        this.#handleServerMessage(event.data);
      };

      ws.onerror = () => {
        const message = "OpenAI Realtime connection error.";
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
          reject(new Error(`OpenAI Realtime closed before connecting: ${reason}`));
          return;
        }
        this.#ws = null;
        this.#assistantSpeaking = false;
        callbacks.onClose(reason, unexpected);
      };
    });
  }

  sendAudioChunk(pcmBase64: string, sampleRate: number): void {
    if (!pcmBase64 || !this.#isOpen()) return;
    const pcm24k =
      sampleRate === 24_000
        ? pcmBase64
        : pcm16Base64ToResampledBase64(pcmBase64, sampleRate, 24_000);
    this.#sendJson({
      type: "input_audio_buffer.append",
      audio: pcm24k,
    });
  }

  sendTextTurn(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || !this.#isOpen()) return;
    this.#callbacks?.onUserTranscript(trimmed, true);
    this.#callbacks?.onStateChange("thinking");
    this.#sendJson({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: trimmed }],
      },
    });
    this.#sendJson({
      type: "response.create",
    });
  }

  interrupt(): void {
    this.#assistantSpeaking = false;
    this.#assistantTranscriptBuffer = "";
    this.#callbacks?.onBargeIn();
    if (this.#isOpen()) {
      this.#sendJson({ type: "response.cancel" });
    }
  }

  async updateSession(patch: Partial<TransportSessionConfig>): Promise<void> {
    if (!this.#config) return;
    const merged: TransportSessionConfig = {
      ...this.#config,
      ...patch,
    };
    this.#config = merged;
    if (this.#isOpen()) {
      this.#sendJson(buildOpenAiSessionUpdatePayload(merged));
    }
  }

  async disconnect(): Promise<void> {
    this.#closingIntentionally = true;
    this.#assistantSpeaking = false;
    this.#userTranscriptBuffer = "";
    this.#assistantTranscriptBuffer = "";
    const ws = this.#ws;
    this.#ws = null;
    if (ws) {
      try {
        ws.close(1000, "Session ended");
      } catch {
        // Ignore close errors during teardown.
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
    let event: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawData);
      if (!parsed || typeof parsed !== "object") return;
      event = parsed as Record<string, unknown>;
    } catch {
      return;
    }

    const type = typeof event.type === "string" ? event.type : "";
    const callbacks = this.#callbacks;
    if (!callbacks) return;

    switch (type) {
      case "input_audio_buffer.speech_started": {
        this.#userTranscriptBuffer = "";
        if (this.#config?.bargeInEnabled) {
          callbacks.onBargeIn();
          if (this.#assistantSpeaking) {
            this.#assistantSpeaking = false;
            this.#assistantTranscriptBuffer = "";
            this.#sendJson({ type: "response.cancel" });
          }
          callbacks.onStateChange("interrupted");
        }
        callbacks.onStateChange("listening");
        break;
      }

      case "input_audio_buffer.speech_stopped": {
        callbacks.onStateChange("thinking");
        break;
      }

      case "conversation.item.input_audio_transcription.delta": {
        if (typeof event.delta === "string" && event.delta.length > 0) {
          this.#userTranscriptBuffer += event.delta;
          callbacks.onUserTranscript(this.#userTranscriptBuffer, false);
        }
        break;
      }

      case "conversation.item.input_audio_transcription.completed": {
        const finalTranscript =
          typeof event.transcript === "string" && event.transcript.trim().length > 0
            ? event.transcript.trim()
            : this.#userTranscriptBuffer.trim();
        this.#userTranscriptBuffer = "";
        if (finalTranscript.length > 0) {
          callbacks.onUserTranscript(finalTranscript, true);
        }
        break;
      }

      case "response.audio.delta":
      case "response.output_audio.delta": {
        if (typeof event.delta === "string" && event.delta.length > 0) {
          if (!this.#assistantSpeaking) {
            this.#assistantSpeaking = true;
            callbacks.onStateChange("speaking");
          }
          callbacks.onAudioDelta(event.delta, 24_000);
        }
        break;
      }

      case "response.audio_transcript.delta":
      case "response.output_audio_transcript.delta": {
        if (typeof event.delta === "string" && event.delta.length > 0) {
          this.#assistantTranscriptBuffer += event.delta;
          callbacks.onAssistantTranscript(this.#assistantTranscriptBuffer, false);
        }
        break;
      }

      case "response.audio_transcript.done":
      case "response.output_audio_transcript.done": {
        const finalText =
          typeof event.transcript === "string" && event.transcript.trim().length > 0
            ? event.transcript.trim()
            : this.#assistantTranscriptBuffer.trim();
        if (finalText.length > 0) {
          callbacks.onAssistantTranscript(finalText, true);
        }
        this.#assistantTranscriptBuffer = "";
        break;
      }

      case "response.done": {
        this.#assistantSpeaking = false;
        callbacks.onStateChange("listening");
        break;
      }

      case "response.function_call_arguments.done": {
        void this.#handleFunctionCall(event);
        break;
      }

      case "error": {
        const errObj =
          event.error && typeof event.error === "object"
            ? (event.error as Record<string, unknown>)
            : null;
        const message =
          typeof errObj?.message === "string"
            ? errObj.message
            : "OpenAI Realtime returned an error.";
        const code = typeof errObj?.code === "string" ? errObj.code : "";
        // Canceling an already-finished response is benign during rapid barge-in.
        if (code === "response_cancel_not_active") return;
        callbacks.onError(message, code !== "invalid_api_key");
        break;
      }

      default:
        break;
    }
  }

  async #handleFunctionCall(event: Record<string, unknown>): Promise<void> {
    const callId = typeof event.call_id === "string" ? event.call_id : "";
    const name = typeof event.name === "string" ? event.name : "";
    const argsRaw = typeof event.arguments === "string" ? event.arguments : "{}";
    if (!callId || !name || !this.#callbacks?.onToolCall) return;

    let parsedArgs: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(argsRaw);
      if (parsed && typeof parsed === "object") {
        parsedArgs = parsed as Record<string, unknown>;
      }
    } catch {
      parsedArgs = {};
    }

    this.#callbacks.onStateChange("thinking");
    const result = await this.#callbacks.onToolCall(name, parsedArgs);
    if (!this.#isOpen()) return;

    this.#sendJson({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(result),
      },
    });
    this.#sendJson({
      type: "response.create",
    });
  }
}
