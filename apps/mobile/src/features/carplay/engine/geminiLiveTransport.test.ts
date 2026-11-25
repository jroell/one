import { describe, expect, it, vi } from "vite-plus/test";

import { AGENT_BRIDGE_TOOLS } from "./agentBridgeTools";
import { GeminiLiveTransport } from "./geminiLiveTransport";
import {
  base64ToBytes,
  bytesToBase64,
  int16ToPcm16Bytes,
  pcm16BytesToInt16,
  resamplePcm16,
} from "./pcmAudio";
import { getPersonaById } from "./personas";
import type { TransportCallbacks, TransportSessionConfig, WebSocketLike } from "./types";
import { getVoiceById } from "./voiceCatalog";

class FakeGeminiSocket implements WebSocketLike {
  readyState = 0;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { readonly data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { readonly code?: number; readonly reason?: string }) => void) | null = null;
  readonly sent: Array<Record<string, unknown>> = [];

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
    this.onclose?.({ code, reason });
  }
}

function createConfig(voiceId = "gemini:Puck"): TransportSessionConfig {
  return {
    voice: getVoiceById(voiceId),
    persona: getPersonaById("architect"),
    instructions: "Spar on system design.",
    vadMode: "semantic_vad",
    bargeInEnabled: true,
    bargeInSensitivity: "balanced",
    spokenSpeed: 1.0,
    tools: AGENT_BRIDGE_TOOLS,
  };
}

describe("GeminiLiveTransport and PCM resampling", () => {
  it("resamples 24kHz PCM16 to 16kHz accurately and clamps values cleanly", () => {
    const input = new Int16Array(240);
    for (let i = 0; i < input.length; i++) {
      input[i] = Math.round(Math.sin((i / 240) * Math.PI * 2) * 16_000);
    }
    const downsampled = resamplePcm16(input, 24_000, 16_000);
    expect(downsampled.length).toBe(160);
    const upsampled = resamplePcm16(downsampled, 16_000, 24_000);
    expect(upsampled.length).toBe(240);
  });

  it("sends setup handshake, resamples 24kHz mic chunks to 16kHz, plays audio, and handles interruption + tool calls", async () => {
    const sockets: Array<FakeGeminiSocket> = [];
    const transport = new GeminiLiveTransport({
      apiKey: "AIza-secret-gemini-key",
      model: "gemini-2.5-flash-native-audio-preview",
      webSocketFactory: () => {
        const ws = new FakeGeminiSocket();
        sockets.push(ws);
        return ws;
      },
    });

    const callbacks: TransportCallbacks = {
      onConnected: vi.fn(),
      onStateChange: vi.fn(),
      onAudioDelta: vi.fn(),
      onBargeIn: vi.fn(),
      onUserTranscript: vi.fn(),
      onAssistantTranscript: vi.fn(),
      onToolCall: vi.fn(async () => ({
        ok: true,
        status: "completed" as const,
        spokenSummary: "Zero pending approvals.",
      })),
      onError: vi.fn(),
      onClose: vi.fn(),
    };

    const connectPromise = transport.connect(createConfig(), callbacks);
    const ws = sockets[0]!;
    ws.open();
    await connectPromise;

    expect(ws.sent[0]).toMatchObject({
      setup: {
        model: "models/gemini-2.5-flash-native-audio-preview",
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Puck",
              },
            },
          },
        },
      },
    });

    // Chunks before setupComplete are buffered/dropped safely
    const samples24k = new Int16Array(240).fill(4_000);
    const pcm24kBase64 = bytesToBase64(int16ToPcm16Bytes(samples24k));
    transport.sendAudioChunk(pcm24kBase64, 24_000);
    expect(ws.sent).toHaveLength(1);

    // Server confirms setupComplete
    ws.receive({ setupComplete: {} });
    expect(callbacks.onConnected).toHaveBeenCalledTimes(1);

    // Now 24kHz mic audio resamples to 16kHz (160 samples = 320 bytes)
    transport.sendAudioChunk(pcm24kBase64, 24_000);
    const mediaMsg = ws.sent[1] as {
      readonly realtimeInput: {
        readonly mediaChunks: ReadonlyArray<{ readonly mimeType: string; readonly data: string }>;
      };
    };
    expect(mediaMsg.realtimeInput.mediaChunks[0]?.mimeType).toBe("audio/pcm;rate=16000");
    const sentSamples = pcm16BytesToInt16(
      base64ToBytes(mediaMsg.realtimeInput.mediaChunks[0]!.data),
    );
    expect(sentSamples.length).toBe(160);

    // Server returns 24kHz audio turn
    ws.receive({
      serverContent: {
        modelTurn: {
          parts: [
            {
              inlineData: {
                mimeType: "audio/pcm;rate=24000",
                data: pcm24kBase64,
              },
            },
          ],
        },
        outputTranscription: { text: "Keep the queue idempotent." },
      },
    });
    expect(callbacks.onAudioDelta).toHaveBeenCalledWith(pcm24kBase64, 24_000);
    expect(callbacks.onAssistantTranscript).toHaveBeenCalledWith(
      "Keep the queue idempotent.",
      false,
    );

    // Barge-in interruption from Gemini Live
    ws.receive({ serverContent: { interrupted: true } });
    expect(callbacks.onBargeIn).toHaveBeenCalledTimes(1);

    // Function call round-trip
    ws.receive({
      toolCall: {
        functionCalls: [
          {
            id: "fc-1",
            name: "list_pending_approvals",
            args: {},
          },
        ],
      },
    });

    await vi.waitFor(() => {
      expect(ws.sent.some((m) => "toolResponse" in m)).toBe(true);
    });

    // Error callback never leaks API key
    ws.onerror?.(new Error("socket failed with AIza-secret-gemini-key"));
    expect(callbacks.onError).toHaveBeenCalledWith("Gemini Live connection error.", true);

    // Switching voice reconnects cleanly with the new prebuiltVoiceConfig
    const switchPromise = transport.updateSession({ voice: getVoiceById("gemini:Charon") });
    await vi.waitFor(() => expect(sockets.length).toBe(2));
    sockets[1]!.open();
    await switchPromise;
    expect(sockets[1]!.sent[0]).toMatchObject({
      setup: {
        generationConfig: {
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Charon",
              },
            },
          },
        },
      },
    });
  });
});
