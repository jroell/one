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

describe("OpenAiRealtimeTransport", () => {
  it("connects with bearer header, sends session.update, streams audio, and handles barge-in", async () => {
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
    await connectPromise;

    expect(capturedUrl).toBe("wss://api.openai.com/v1/realtime?model=gpt-realtime");
    expect(capturedHeaders).toMatchObject({
      Authorization: "Bearer sk-realtime-secret",
      "OpenAI-Beta": "realtime=v1",
    });

    expect(fakeWs.sent[0]).toMatchObject({
      type: "session.update",
      session: {
        voice: "marin",
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        turn_detection: {
          type: "semantic_vad",
          interrupt_response: true,
        },
      },
    });

    // Stream mic chunk
    const pcmChunk = bytesToBase64(int16ToPcm16Bytes(new Int16Array([1000, -1000, 500, -500])));
    transport.sendAudioChunk(pcmChunk, 24_000);
    expect(fakeWs.sent[1]).toEqual({
      type: "input_audio_buffer.append",
      audio: pcmChunk,
    });

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
    expect(fakeWs.sent.some((msg) => msg.type === "response.cancel")).toBe(true);
    expect(callbacks.onStateChange).toHaveBeenCalledWith("interrupted");
    expect(callbacks.onStateChange).toHaveBeenCalledWith("listening");

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

  it("executes Agent Bridge function calls and supports mid-session voice switch without reconnect", async () => {
    const fakeWs = new FakeWebSocket();
    const transport = new OpenAiRealtimeTransport({
      apiKey: "sk-realtime-secret",
      webSocketFactory: () => fakeWs,
    });
    const callbacks = createCallbacks();
    const connectPromise = transport.connect(
      createSessionConfig({ vadMode: "server_vad" }),
      callbacks,
    );
    fakeWs.open();
    await connectPromise;

    // Receive tool call
    fakeWs.receive({
      type: "response.function_call_arguments.done",
      call_id: "call_42",
      name: "list_active_threads",
      arguments: "{}",
    });

    await vi.waitFor(() => {
      expect(fakeWs.sent.some((msg) => msg.type === "conversation.item.create")).toBe(true);
    });

    const toolOutputMsg = fakeWs.sent.find((msg) => msg.type === "conversation.item.create");
    expect(toolOutputMsg).toMatchObject({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: "call_42",
      },
    });
    expect(fakeWs.sent[fakeWs.sent.length - 1]).toEqual({ type: "response.create" });

    // Mid-session voice switch sends session.update without closing socket
    await transport.updateSession({ voice: getVoiceById("openai:cedar") });
    const latestUpdate = [...fakeWs.sent].reverse().find((msg) => msg.type === "session.update");
    expect((latestUpdate?.session as Record<string, unknown>)?.voice).toBe("cedar");
    expect(fakeWs.closedWith).toBeNull();

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
