import { afterEach, describe, expect, it, vi } from "vite-plus/test";

// The upload path writes a real file; a fake File stands in for the native one.
const fileWrites = vi.hoisted(() => ({ bytes: [] as Array<Uint8Array> }));
vi.mock("expo-file-system", () => {
  const BaseBlob = globalThis.Blob;
  class File extends BaseBlob {
    readonly uri: string;
    constructor(_dir: unknown, name: string) {
      super([], { type: "audio/wav" });
      this.uri = `file:///cache/${name}`;
    }
    create(): void {}
    async write(content: Uint8Array): Promise<void> {
      fileWrites.bytes.push(content);
    }
    delete(): void {}
    override async arrayBuffer(): Promise<ArrayBuffer> {
      const last = fileWrites.bytes[fileWrites.bytes.length - 1]!;
      return last.buffer.slice(last.byteOffset, last.byteOffset + last.byteLength) as ArrayBuffer;
    }
  }
  return { File, Paths: { cache: {} } };
});
vi.mock("../../../native/voiceTranscription", () => ({
  getLocalVoiceTranscriber: async () => null,
}));

import { AGENT_BRIDGE_TOOLS } from "./agentBridgeTools";
import { FallbackTurnTransport } from "./fallbackTurnTransport";
import { bytesToBase64, int16ToPcm16Bytes } from "./pcmAudio";
import { getPersonaById } from "./personas";
import type { PcmTranscriber } from "./speechInput";
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

/** Callbacks plus a way to wait for the next time the transport settles back to rest. */
function createCallbacks() {
  const restWaiters: Array<() => void> = [];
  const callbacks: TransportCallbacks = {
    onConnected: vi.fn(),
    onStateChange: vi.fn((state) => {
      if (state === "listening" || state === "idle") {
        for (const resolve of restWaiters.splice(0)) resolve();
      }
    }),
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
    onInputUnavailable: vi.fn(),
  };
  return {
    callbacks,
    nextRest: () => new Promise<void>((resolve) => restWaiters.push(resolve)),
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

const LOUD_CHUNK = bytesToBase64(int16ToPcm16Bytes(new Int16Array(2_400).fill(12_000)));
const QUIET_CHUNK = bytesToBase64(int16ToPcm16Bytes(new Int16Array(2_400).fill(0)));

function speak(transport: FallbackTurnTransport, loudChunks = 2): void {
  for (let i = 0; i < loudChunks; i++) transport.sendAudioChunk(LOUD_CHUNK, 24_000);
  for (let i = 0; i < 7; i++) transport.sendAudioChunk(QUIET_CHUNK, 24_000);
}

describe("FallbackTurnTransport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    fileWrites.bytes.length = 0;
  });

  it("says it cannot hear on a phone without speech recognition, and still answers typed turns locally", async () => {
    const native = createMockNative();
    const { callbacks, nextRest } = createCallbacks();
    const transport = new FallbackTurnTransport({
      provider: "on-device",
      native,
      getApiKey: async () => null,
      getLocalTranscriber: async () => null,
    });

    await transport.connect(createConfig("on-device:pilot"), callbacks);
    expect(callbacks.onInputUnavailable).toHaveBeenCalledTimes(1);
    expect(vi.mocked(callbacks.onStateChange).mock.calls.map(([state]) => state)).not.toContain(
      "listening",
    );

    const rested = nextRest();
    transport.sendTextTurn("Check my thread status");
    await rested;
    expect(native.speakFallbackText).toHaveBeenCalledWith(
      "You have 2 active threads. 1 running, 0 waiting for approval.",
      expect.objectContaining({ voiceId: "on-device:pilot" }),
    );
    expect(callbacks.onToolCall).toHaveBeenCalledWith("list_active_threads", {});
    // The driver's voice goes nowhere while the session cannot hear.
    const calls = vi.mocked(callbacks.onToolCall!).mock.calls.length;
    speak(transport);
    expect(callbacks.onToolCall).toHaveBeenCalledTimes(calls);
  });

  it("names the missing OpenAI key when the ElevenLabs voice has nothing to hear with", async () => {
    const { callbacks } = createCallbacks();
    const transport = new FallbackTurnTransport({
      provider: "elevenlabs",
      native: createMockNative(),
      getApiKey: async (provider) => (provider === "elevenlabs" ? "el-key" : null),
      getLocalTranscriber: async () => null,
    });

    await transport.connect(createConfig("elevenlabs:rachel"), callbacks);
    expect(callbacks.onInputUnavailable).toHaveBeenCalledWith(
      "This voice needs an OpenAI key to hear you. Add one in setup, or type.",
    );
  });

  it("reports the recognizer's own failure instead of silently going deaf", async () => {
    const { callbacks } = createCallbacks();
    const transport = new FallbackTurnTransport({
      provider: "on-device",
      native: createMockNative(),
      getApiKey: async () => null,
      getLocalTranscriber: async () => {
        throw new Error("Voice transcription does not support any of your languages.");
      },
    });

    await transport.connect(createConfig("on-device:pilot"), callbacks);
    expect(callbacks.onInputUnavailable).toHaveBeenCalledWith(
      "Voice transcription does not support any of your languages.",
    );
  });

  it("keeps On-Device microphone audio and transcripts off the network even when an OpenAI key is saved", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const native = createMockNative();
    const getApiKey = async (provider: string) => (provider === "openai" ? "sk-openai" : null);

    // No phone recognizer: the driver cannot be heard, and nothing is uploaded.
    const deaf = createCallbacks();
    const deafTransport = new FallbackTurnTransport({
      provider: "on-device",
      native,
      getApiKey,
      getLocalTranscriber: async () => null,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await deafTransport.connect(createConfig("on-device:pilot"), deaf.callbacks);
    speak(deafTransport);
    expect(deaf.callbacks.onInputUnavailable).toHaveBeenCalledTimes(1);

    // With a phone recognizer the turn is transcribed and answered on the phone.
    const heard = createCallbacks();
    const transcribe: PcmTranscriber = vi.fn(async () => "How are my approvals?");
    const heardTransport = new FallbackTurnTransport({
      provider: "on-device",
      native,
      getApiKey,
      getLocalTranscriber: async () => transcribe,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await heardTransport.connect(createConfig("on-device:pilot"), heard.callbacks);
    const rested = heard.nextRest();
    speak(heardTransport);
    await rested;
    expect(heard.callbacks.onToolCall).toHaveBeenCalledWith("list_pending_approvals", {});

    // A reply the bridge cannot answer is not sent to OpenAI either.
    const typed = heard.nextRest();
    heardTransport.sendTextTurn("Tell me a story about trains");
    await typed;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uploads ElevenLabs-voice speech to OpenAI as a file part, not a Blob built from an ArrayBuffer", async () => {
    // React Native's Blob throws for ArrayBuffer parts, which is what broke the first upload.
    const RealBlob = globalThis.Blob;
    vi.stubGlobal(
      "Blob",
      class StrictBlob extends RealBlob {
        constructor(parts?: Array<BlobPart>, options?: BlobPropertyBag) {
          if (parts?.some((part) => part instanceof ArrayBuffer || ArrayBuffer.isView(part))) {
            throw new Error(
              "Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' is not supported",
            );
          }
          super(parts, options);
        }
      },
    );

    let uploadedAuthorization: string | null = null;
    let uploadedModel: FormDataEntryValue | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("audio/transcriptions")) {
        uploadedAuthorization = new Headers(init?.headers).get("authorization");
        uploadedModel = (init!.body as FormData).get("model");
        return new Response(JSON.stringify({ text: "How are my approvals?" }), { status: 200 });
      }
      return new Response("", { status: 404 });
    });
    const { callbacks, nextRest } = createCallbacks();
    const transport = new FallbackTurnTransport({
      provider: "elevenlabs",
      native: createMockNative(),
      getApiKey: async (provider) => (provider === "openai" ? "sk-openai" : "el-key"),
      getLocalTranscriber: async () => null,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await transport.connect(createConfig("elevenlabs:rachel"), callbacks);
    expect(callbacks.onInputUnavailable).not.toHaveBeenCalled();

    const rested = nextRest();
    speak(transport);
    await rested;

    expect(uploadedAuthorization).toBe("Bearer sk-openai");
    expect(uploadedModel).toBe("gpt-4o-mini-transcribe");
    expect(fileWrites.bytes).toHaveLength(1);
    expect(new TextDecoder().decode(fileWrites.bytes[0]!.subarray(0, 4))).toBe("RIFF");
    expect(callbacks.onToolCall).toHaveBeenCalledWith("list_pending_approvals", {});
  });

  it("surfaces a transcription failure as an error instead of returning to Listening silently", async () => {
    const { callbacks, nextRest } = createCallbacks();
    const transport = new FallbackTurnTransport({
      provider: "on-device",
      native: createMockNative(),
      getApiKey: async () => null,
      transcribePcm: async () => {
        throw new Error("Speech service is busy.");
      },
    });
    await transport.connect(createConfig("on-device:pilot"), callbacks);

    const rested = nextRest();
    speak(transport);
    await rested;
    expect(callbacks.onError).toHaveBeenCalledWith("Speech service is busy.", true);
  });

  it("routes approve and decline requests to the approvals refusal instead of the approvals list", async () => {
    const { callbacks, nextRest } = createCallbacks();
    const transport = new FallbackTurnTransport({
      provider: "on-device",
      native: createMockNative(),
      getApiKey: async () => null,
      transcribePcm: async () => "Approve it for the whole session",
    });
    await transport.connect(createConfig("on-device:pilot"), callbacks);

    const rested = nextRest();
    speak(transport);
    await rested;
    expect(callbacks.onToolCall).toHaveBeenCalledWith("respond_to_approval", {});
    expect(callbacks.onToolCall).not.toHaveBeenCalledWith("list_pending_approvals", {});
  });

  it("cuts an utterance off at the cap and hands transcription an abort signal that interrupt trips", async () => {
    const { callbacks } = createCallbacks();
    const signals: Array<AbortSignal> = [];
    const sizes: Array<number> = [];
    const transport = new FallbackTurnTransport({
      provider: "on-device",
      native: createMockNative(),
      getApiKey: async () => null,
      transcribePcm: (pcm, signal) => {
        sizes.push(pcm.byteLength);
        signals.push(signal);
        return new Promise(() => undefined);
      },
    });
    await transport.connect(createConfig("on-device:pilot"), callbacks);

    // 100 ms chunks of constant loud noise never reach the trailing silence that commits a turn.
    for (let i = 0; i < 250; i++) transport.sendAudioChunk(LOUD_CHUNK, 24_000);
    expect(sizes).toHaveLength(1);
    // 20 seconds of 24 kHz mono PCM16 is 960,000 bytes; the cut falls on the chunk that crosses it.
    expect(sizes[0]).toBeLessThan(960_000 + 4_800);
    expect(sizes[0]).toBeGreaterThanOrEqual(960_000);

    expect(signals[0]!.aborted).toBe(false);
    transport.interrupt();
    expect(signals[0]!.aborted).toBe(true);
  });

  it("ignores a transcription that finishes after a newer turn took over", async () => {
    const { callbacks, nextRest } = createCallbacks();
    let finishFirst!: (text: string) => void;
    const transcribe = vi.fn(
      (): Promise<string | null> =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    const transport = new FallbackTurnTransport({
      provider: "on-device",
      native: createMockNative(),
      getApiKey: async () => null,
      transcribePcm: transcribe,
    });
    await transport.connect(createConfig("on-device:pilot"), callbacks);

    speak(transport);
    expect(transcribe).toHaveBeenCalledTimes(1);
    const firstResult = transcribe.mock.results[0]!.value as Promise<string | null>;

    // The driver interrupts and types something else; that turn completes first.
    transport.interrupt();
    const typedDone = nextRest();
    transport.sendTextTurn("Check my thread status");
    await typedDone;
    const userTranscripts = vi.mocked(callbacks.onUserTranscript).mock.calls.length;

    finishFirst("How are my approvals?");
    await firstResult;
    expect(callbacks.onUserTranscript).toHaveBeenCalledTimes(userTranscripts);
    expect(callbacks.onToolCall).not.toHaveBeenCalledWith("list_pending_approvals", {});
  });
});
