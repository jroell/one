import { describe, expect, it, vi } from "vite-plus/test";

import {
  CAR_SAFE_SPEECH_RULES,
  DRIVING_PERSONAS,
  buildPersonaInstructions,
  getPersonaById,
  sanitizeForSpeech,
} from "./personas";
import type { CarPlayNativeAdapter } from "./types";
import {
  VOICE_CATALOG,
  filterVoices,
  getOrderedVoicesForCarPlay,
  getVoiceById,
  previewVoiceSample,
} from "./voiceCatalog";

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

describe("voiceCatalog and personas", () => {
  it("curates at least 26 distinct voices across all four providers with clean copy", () => {
    expect(VOICE_CATALOG.length).toBeGreaterThanOrEqual(26);

    const ids = new Set(VOICE_CATALOG.map((voice) => voice.id));
    expect(ids.size).toBe(VOICE_CATALOG.length);

    const byProvider = {
      "openai-realtime": VOICE_CATALOG.filter((v) => v.provider === "openai-realtime"),
      "gemini-live": VOICE_CATALOG.filter((v) => v.provider === "gemini-live"),
      elevenlabs: VOICE_CATALOG.filter((v) => v.provider === "elevenlabs"),
      "on-device": VOICE_CATALOG.filter((v) => v.provider === "on-device"),
    };

    expect(byProvider["openai-realtime"]).toHaveLength(10);
    expect(byProvider["gemini-live"]).toHaveLength(10);
    expect(byProvider.elevenlabs).toHaveLength(6);
    expect(byProvider["on-device"].length).toBeGreaterThanOrEqual(3);

    for (const voice of VOICE_CATALOG) {
      expect(voice.tagline).not.toMatch(/[\u2014\u2013]/);
      expect(voice.sampleLine).not.toMatch(/[\u2014\u2013]/);
      expect(voice.defaultSpeed).toBeGreaterThanOrEqual(0.75);
      expect(voice.defaultSpeed).toBeLessThanOrEqual(1.5);
    }
  });

  it("filters voices by provider, vibe, favorites, and search query", () => {
    const geminiWarm = filterVoices(VOICE_CATALOG, { provider: "gemini-live", vibe: "warm" });
    expect(geminiWarm.length).toBeGreaterThanOrEqual(2);
    expect(geminiWarm.every((v) => v.provider === "gemini-live" && v.vibe === "warm")).toBe(true);

    const favs = filterVoices(VOICE_CATALOG, {
      favoritesOnly: true,
      favoriteIds: ["openai:cedar", "gemini:Puck"],
    });
    expect(favs.map((v) => v.id)).toEqual(["openai:cedar", "gemini:Puck"]);

    const queryMatches = filterVoices(VOICE_CATALOG, { query: "umbriel" });
    expect(queryMatches.map((v) => v.id)).toEqual(["gemini:Umbriel"]);
  });

  it("orders CarPlay voices with active voice first followed by favorites", () => {
    const ordered = getOrderedVoicesForCarPlay(["gemini:Puck", "openai:cedar"], "openai:ash");
    expect(ordered[0]?.id).toBe("openai:ash");
    expect(ordered[1]?.id).toBe("gemini:Puck");
    expect(ordered[2]?.id).toBe("openai:cedar");
  });

  it("auditions OpenAI voices through OpenAI TTS when key is configured and falls back cleanly without key", async () => {
    const native = createMockNative();
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
        }),
    ) as unknown as typeof fetch;

    const cloudResult = await previewVoiceSample("openai:marin", {
      native,
      getApiKey: async (provider) => (provider === "openai" ? "sk-test-key" : null),
      fetchImpl: fetchMock,
    });

    expect(cloudResult.mode).toBe("openai-tts");
    expect(native.enqueuePcmAudio).toHaveBeenCalledTimes(1);
    expect(native.speakFallbackText).not.toHaveBeenCalled();

    const native2 = createMockNative();
    const offlineResult = await previewVoiceSample("openai:marin", {
      native: native2,
      getApiKey: async () => null,
      fetchImpl: fetchMock,
    });

    expect(offlineResult.mode).toBe("on-device");
    expect(native2.speakFallbackText).toHaveBeenCalledWith(
      getVoiceById("openai:marin").sampleLine,
      expect.objectContaining({ voiceId: "openai:marin" }),
    );
  });

  it("auditions ElevenLabs voices with custom voice ID override when configured", async () => {
    const native = createMockNative();
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([10, 20, 30, 40]), {
          status: 200,
        }),
    ) as unknown as typeof fetch;

    const result = await previewVoiceSample("elevenlabs:rachel", {
      native,
      getApiKey: async (provider) => (provider === "elevenlabs" ? "el-test-key" : null),
      elevenLabsCustomVoiceId: "custom-voice-999",
      fetchImpl: fetchMock,
    });

    expect(result.mode).toBe("elevenlabs-tts");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/text-to-speech/custom-voice-999?output_format=pcm_24000"),
      expect.objectContaining({
        headers: expect.objectContaining({ "xi-api-key": "el-test-key" }),
      }),
    );
    expect(native.enqueuePcmAudio).toHaveBeenCalledTimes(1);
  });

  it("provides all 7 driving personas with car-safe spoken rules and sanitizes markdown for speech", () => {
    expect(DRIVING_PERSONAS.map((p) => p.id)).toEqual([
      "copilot",
      "agent-bridge",
      "architect",
      "brainstorm",
      "briefing",
      "lore",
      "conqueror",
    ]);

    const instructions = buildPersonaInstructions(getPersonaById("agent-bridge"), {
      agentBridgeEnabled: true,
      activeThread: {
        environmentId: "env-1",
        threadId: "t-1",
        title: "Fix auth retry",
        status: "needs_approval",
        pendingApprovalCount: 1,
        lastActivityLabel: "Needs approval",
      },
    });
    expect(instructions).toContain(CAR_SAFE_SPEECH_RULES);
    expect(instructions).toContain("Fix auth retry");

    const sanitized = sanitizeForSpeech(
      "## Build **passed**\n- Check [PR](https://example.com/pr/1)\n```ts\nconst x = 1;\n```\nVisit https://example.com",
    );
    expect(sanitized).not.toContain("##");
    expect(sanitized).not.toContain("**");
    expect(sanitized).not.toContain("const x = 1");
    expect(sanitized).not.toContain("https://");
    expect(sanitized).toContain("Build passed");
  });
});
