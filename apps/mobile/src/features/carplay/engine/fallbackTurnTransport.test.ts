import { describe, expect, it, vi } from "vite-plus/test";

import { AGENT_BRIDGE_TOOLS } from "./agentBridgeTools";
import { FallbackTurnTransport } from "./fallbackTurnTransport";
import { bytesToBase64, int16ToPcm16Bytes } from "./pcmAudio";
import { getPersonaById } from "./personas";
import type { CarPlayNativeAdapter, TransportCallbacks, TransportSessionConfig } from "./types";
import { getVoiceById } from "./voiceCatalog";

function createMockNative(): CarPlayNativeAdapter {
  const noopSub = { remove: vi.fn() };
  return {
    startAudioSession: vi.fn(async () => undefined),
    stopAudioSession: vi.fn(async () => undefined),
    enqueuePcmAudio: vi.fn(async () => undefined),
    clearPlaybackQueue: vi.fn(async () => undefined),
    setMuted: vi.fn(async () => undefined),
    speakFallbackText: vi.fn(async () => undefined),
    stopFallbackSpeech: vi.fn(async () => undefined),
    updateCarPlayState: vi.fn(async () => undefined),
    getCarPlayStatus: vi.fn(async () => ({ connected: false })),
    addAudioChunkListener: vi.fn(() => noopSub),
    addAudioLevelListener: vi.fn(() => noopSub),
    addCarPlayActionListener: vi.fn(() => noopSub),
    addCarPlayConnectionListener: vi.fn(() => noopSub),
    addInterruptionListener: vi.fn(() => noopSub),
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
      spokenSummary: "You have 2 active threads. 1 running, 0 waiting for approval.",
    })),
    onError: vi.fn(),
    onClose: vi.fn(),
  };
}

function createConfig(voiceId: string): TransportSessionConfig {
  return {
    voice: getVoiceById(voiceId),
    persona: getPersonaById("copilot"),
    instructions: "Be brief.",
    vadMode: "semantic_vad",
    bargeInEnabled: true,
    bargeInSensitivity: "balanced",
    spokenSpeed: 1.0,
    tools: AGENT_BRIDGE_TOOLS,
  };
}

describe("FallbackTurnTransport", () => {
  it("works with zero API keys using local Agent Bridge routing and native speech", async () => {
    const native = createMockNative();
    const callbacks = createCallbacks();
    const transport = new FallbackTurnTransport({
      provider: "on-device",
      native,
      getApiKey: async () => null,
    });

    await transport.connect(createConfig("on-device:pilot"), callbacks);
    transport.sendTextTurn("Check my thread status");

    await vi.waitFor(() => {
      expect(native.speakFallbackText).toHaveBeenCalledWith(
        "You have 2 active threads. 1 running, 0 waiting for approval.",
        expect.objectContaining({ voiceId: "on-device:pilot" }),
      );
    });
    expect(callbacks.onToolCall).toHaveBeenCalledWith("list_active_threads", {});
    expect(callbacks.onAssistantTranscript).toHaveBeenCalledWith(
      "You have 2 active threads. 1 running, 0 waiting for approval.",
      true,
    );
  });

  it("streams ElevenLabs PCM audio when ElevenLabs voice and key are configured", async () => {
    const native = createMockNative();
    const callbacks = createCallbacks();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("chat/completions")) {
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Take the next exit and grab coffee." } }],
          }),
          { status: 200 },
        );
      }
      if (url.includes("api.elevenlabs.io")) {
        return new Response(new Uint8Array([5, 6, 7, 8]), { status: 200 });
      }
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    const transport = new FallbackTurnTransport({
      provider: "elevenlabs",
      native,
      getApiKey: async (provider) => {
        if (provider === "openai") return "sk-chat";
        if (provider === "elevenlabs") return "el-key";
        return null;
      },
      fetchImpl: fetchMock,
    });

    await transport.connect(createConfig("elevenlabs:rachel"), callbacks);
    transport.sendTextTurn("What should I do at the next exit?");

    await vi.waitFor(() => {
      expect(callbacks.onAudioDelta).toHaveBeenCalledTimes(1);
    });
    expect(native.speakFallbackText).not.toHaveBeenCalled();
  });

  it("commits spoken audio turns after trailing silence and clears playback on barge-in", async () => {
    const native = createMockNative();
    const callbacks = createCallbacks();
    const transcribePcm = vi.fn(async () => "How are my approvals?");

    const transport = new FallbackTurnTransport({
      provider: "on-device",
      native,
      getApiKey: async () => null,
      transcribePcm,
    });

    await transport.connect(createConfig("on-device:pilot"), callbacks);

    // Send 3 loud speech chunks (1200 samples each = 2400 bytes) then 7 silent chunks
    const loud = bytesToBase64(int16ToPcm16Bytes(new Int16Array(1_200).fill(12_000)));
    const quiet = bytesToBase64(int16ToPcm16Bytes(new Int16Array(1_200).fill(0)));

    transport.sendAudioChunk(loud, 24_000);
    transport.sendAudioChunk(loud, 24_000);
    for (let i = 0; i < 7; i++) {
      transport.sendAudioChunk(quiet, 24_000);
    }

    await vi.waitFor(() => {
      expect(transcribePcm).toHaveBeenCalledTimes(1);
      expect(callbacks.onToolCall).toHaveBeenCalledWith("list_pending_approvals", {});
    });

    transport.interrupt();
    expect(native.stopFallbackSpeech).toHaveBeenCalled();
    expect(native.clearPlaybackQueue).toHaveBeenCalled();
    expect(callbacks.onBargeIn).toHaveBeenCalled();
  });
});
