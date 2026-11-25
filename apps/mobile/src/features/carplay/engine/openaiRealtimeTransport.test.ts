import { describe, expect, it, vi } from "vite-plus/test";

import { AGENT_BRIDGE_TOOLS } from "./agentBridgeTools";
import { OpenAiRealtimeTransport } from "./openaiRealtimeTransport";
import { bytesToBase64, int16ToPcm16Bytes } from "./pcmAudio";
import { getPersonaById } from "./personas";
import type { TransportCallbacks, TransportSessionConfig, WebSocketLike } from "./types";
import { getVoiceById } from "./voiceCatalog";

class FakeWebSocket implements WebSocketLike {
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { readonly code?: number; readonly reason?: string }) => void) | null = null;
  readonly sent: Array<Record<string, unknown>> = [];
  closedWith: { readonly code?: number; readonly reason?: string } | null = null;

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closedWith = { code, reason };
    this.onclose?.({ code, reason });
  }
}

function createSessionConfig(
  overrides: Partial<TransportSessionConfig> = {},
): TransportSessionConfig {
  return {
    voice: getVoiceById("openai:marin"),
    persona: getPersonaById("copilot"),
    instructions: "Be concise.",
    vadMode: "semantic_vad",
    bargeInEnabled: true,
    bargeInSensitivity: "balanced",
    spokenSpeed: 1.0,
    tools: AGENT_BRIDGE_TOOLS,
    ...overrides,
  };
}

function createCallbacks(): TransportCallbacks {
  return {
    onConnected: vi.fn(),
    onStateChange: vi.fn(),
    onAudioDelta: vi.fn(),
    onBargeIn: vi.fn(),
    onUserTranscript: vi.fn(),
    onAssistantTranscript: vi.fn(),
    onToolCall: vi.fn(async () => ({
      ok: true,
      status: "completed" as const,
      spokenSummary: "One thread is running.",
    })),
    onError: vi.fn(),
    onClose: vi.fn(),
  };
}

async function connectAndAcknowledge(
  transport: OpenAiRealtimeTransport,
  fakeWs: FakeWebSocket,
  callbacks: TransportCallbacks,
  config: TransportSessionConfig = createSessionConfig(),
): Promise<void> {
  const connectPromise = transport.connect(config, callbacks);
  fakeWs.open();
  fakeWs.receive({ type: "session.updated", session: { type: "realtime" } });
  await connectPromise;
}

describe("OpenAiRealtimeTransport", () => {
  it("connects with the GA handshake and reports listening only after the server accepts the session", async () => {
    const fakeWs = new FakeWebSocket();
    let capturedUrl = "";
    let capturedHeaders: Readonly<Record<string, string>> | undefined;

    const transport = new OpenAiRealtimeTransport({
      apiKey: "sk-realtime-secret",
      model: "gpt-realtime",
      webSocketFactory: (url, opts) => {
        capturedUrl = url;
        capturedHeaders = opts?.headers;
        return fakeWs;
      },
    });

    const callbacks = createCallbacks();
    const connectPromise = transport.connect(createSessionConfig(), callbacks);
    fakeWs.open();

    expect(capturedUrl).toBe("wss://api.openai.com/v1/realtime?model=gpt-realtime");
    expect(capturedHeaders).toEqual({ Authorization: "Bearer sk-realtime-secret" });
    expect(fakeWs.sent[0]).toMatchObject({
      type: "session.update",
      session: {
        type: "realtime",
        output_modalities: ["audio"],
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24_000 },
            transcription: { model: "gpt-4o-mini-transcribe" },
            turn_detection: { type: "semantic_vad", interrupt_response: true },
          },
          output: { format: { type: "audio/pcm", rate: 24_000 }, voice: "marin" },
        },
        tool_choice: "auto",
      },
    });
    // None of the retired beta fields are sent.
    const session = (fakeWs.sent[0] as { session: Record<string, unknown> }).session;
    for (const retired of ["modalities", "voice", "input_audio_format", "output_audio_format"]) {
      expect(session).not.toHaveProperty(retired);
    }

    // Before the server acknowledges the configuration the session is not usable.
    expect(callbacks.onConnected).not.toHaveBeenCalled();
    expect(callbacks.onStateChange).not.toHaveBeenCalledWith("listening");
    const pcmChunk = bytesToBase64(int16ToPcm16Bytes(new Int16Array([1000, -1000, 500, -500])));
    transport.sendAudioChunk(pcmChunk, 24_000);
    transport.sendTextTurn("hello");
    expect(fakeWs.sent).toHaveLength(1);

    fakeWs.receive({ type: "session.updated", session: { type: "realtime" } });
    await connectPromise;
    expect(callbacks.onConnected).toHaveBeenCalledTimes(1);
    expect(callbacks.onStateChange).toHaveBeenCalledWith("listening");

    transport.sendAudioChunk(pcmChunk, 24_000);
    expect(fakeWs.sent[1]).toEqual({ type: "input_audio_buffer.append", audio: pcmChunk });
  });

  it("fails the start when the server answers the configuration with an error", async () => {
    const fakeWs = new FakeWebSocket();
    const transport = new OpenAiRealtimeTransport({
      apiKey: "sk-realtime-secret",
      webSocketFactory: () => fakeWs,
    });
    const callbacks = createCallbacks();
    const connectPromise = transport.connect(createSessionConfig(), callbacks);
    fakeWs.open();
    fakeWs.receive({
      type: "error",
      error: { code: "invalid_value", message: "Unknown parameter: session.modalities." },
    });

    await expect(connectPromise).rejects.toThrow("Unknown parameter: session.modalities.");
    expect(callbacks.onConnected).not.toHaveBeenCalled();
    expect(callbacks.onStateChange).not.toHaveBeenCalledWith("listening");
    expect(fakeWs.closedWith?.code).toBe(1000);
  });

  it("streams audio and handles barge-in", async () => {
    const fakeWs = new FakeWebSocket();
    const transport = new OpenAiRealtimeTransport({
      apiKey: "sk-realtime-secret",
      webSocketFactory: () => fakeWs,
    });
    const callbacks = createCallbacks();
    await connectAndAcknowledge(transport, fakeWs, callbacks);
    const pcmChunk = bytesToBase64(int16ToPcm16Bytes(new Int16Array([1000, -1000, 500, -500])));

    // Assistant streams audio delta (GA event name)
    fakeWs.receive({ type: "response.output_audio.delta", delta: pcmChunk });
    fakeWs.receive({ type: "response.output_audio_transcript.delta", delta: "Heading " });
    fakeWs.receive({ type: "response.output_audio_transcript.delta", delta: "north." });

    expect(callbacks.onAudioDelta).toHaveBeenCalledWith(pcmChunk, 24_000);
    expect(callbacks.onStateChange).toHaveBeenCalledWith("speaking");
    expect(callbacks.onAssistantTranscript).toHaveBeenLastCalledWith("Heading north.", false);

    // Driver speaks mid-response -> instant barge-in + response.cancel
    fakeWs.receive({ type: "input_audio_buffer.speech_started" });
    expect(callbacks.onBargeIn).toHaveBeenCalledTimes(1);
    expect(fakeWs.sent.some((message) => message.type === "response.cancel")).toBe(true);
    expect(callbacks.onStateChange).toHaveBeenCalledWith("interrupted");

    // Incremental user transcription deltas accumulate instead of overwriting
    fakeWs.receive({ type: "conversation.item.input_audio_transcription.delta", delta: "Check " });
    fakeWs.receive({
      type: "conversation.item.input_audio_transcription.delta",
      delta: "my threads",
    });
    expect(callbacks.onUserTranscript).toHaveBeenLastCalledWith("Check my threads", false);
    fakeWs.receive({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "Check my threads.",
    });
    expect(callbacks.onUserTranscript).toHaveBeenLastCalledWith("Check my threads.", true);
  });

  it("executes Agent Bridge function calls and switches voice in the open session until the model has spoken", async () => {
    const fakeWs = new FakeWebSocket();
    const transport = new OpenAiRealtimeTransport({
      apiKey: "sk-realtime-secret",
      webSocketFactory: () => fakeWs,
    });
    const callbacks = createCallbacks();
    await connectAndAcknowledge(
      transport,
      fakeWs,
      callbacks,
      createSessionConfig({ vadMode: "server_vad" }),
    );

    fakeWs.receive({
      type: "response.function_call_arguments.done",
      call_id: "call_42",
      name: "list_active_threads",
      arguments: "{}",
    });

    // The transport sends the tool output right after the callback's promise resolves; awaiting the
    // same promise here queues behind the transport's own continuation.
    await vi.mocked(callbacks.onToolCall!).mock.results[0]!.value;
    expect(
      fakeWs.sent.find((message) => message.type === "conversation.item.create"),
    ).toMatchObject({ item: { type: "function_call_output", call_id: "call_42" } });
    expect(fakeWs.sent[fakeWs.sent.length - 1]).toEqual({ type: "response.create" });

    const cedar = getVoiceById("openai:cedar");
    expect(transport.requiresNewSessionFor({ voice: cedar })).toBe(false);
    await transport.updateSession({ voice: cedar });
    const latestUpdate = [...fakeWs.sent]
      .reverse()
      .find((message) => message.type === "session.update");
    expect(latestUpdate).toMatchObject({
      session: { audio: { output: { voice: "cedar" } } },
    });
    expect(fakeWs.closedWith).toBeNull();

    // OpenAI locks the voice once the model has answered with audio, so a change needs a new session.
    fakeWs.receive({ type: "response.output_audio.delta", delta: "AAAA" });
    expect(transport.requiresNewSessionFor({ voice: getVoiceById("openai:marin") })).toBe(true);
    expect(transport.requiresNewSessionFor({ voice: cedar })).toBe(false);

    // Benign cancel error should not trigger onError
    fakeWs.receive({
      type: "error",
      error: { code: "response_cancel_not_active", message: "No active response" },
    });
    expect(callbacks.onError).not.toHaveBeenCalled();

    await transport.disconnect();
    expect(fakeWs.closedWith?.code).toBe(1000);
  });
});
