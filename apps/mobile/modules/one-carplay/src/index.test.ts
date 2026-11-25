import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const { requireOptionalNativeModuleMock } = vi.hoisted(() => ({
  requireOptionalNativeModuleMock: vi.fn(),
}));

vi.mock("expo", () => ({
  requireOptionalNativeModule: requireOptionalNativeModuleMock,
}));

import {
  addAudioChunkListener,
  addAudioLevelListener,
  addCarPlayActionListener,
  addCarPlayConnectionListener,
  addInterruptionListener,
  clearPlaybackQueue,
  enqueuePcmAudio,
  getCarPlayStatus,
  isNativeCarPlayModuleAvailable,
  setMuted,
  speakFallbackText,
  startAudioSession,
  stopAudioSession,
  stopFallbackSpeech,
  updateCarPlayState,
  type CarPlayDashboardState,
} from "./index.ts";

const SAMPLE_STATE: CarPlayDashboardState = {
  sessionActive: true,
  phase: "listening",
  muted: false,
  voiceId: "marin",
  voiceName: "Marin",
  personaId: "copilot",
  personaName: "Road Co-Pilot",
  topicTitle: "Evening Commute",
  liveCaption: "Listening for your next question.",
  voices: [
    {
      id: "marin",
      displayName: "Marin",
      subtitle: "OpenAI Realtime - Warm",
      group: "OpenAI Realtime",
      isSelected: true,
    },
  ],
  modes: [
    {
      id: "copilot",
      title: "Road Co-Pilot",
      subtitle: "Hands-free conversational partner",
      isSelected: true,
    },
  ],
  threads: [
    {
      id: "thread-1",
      title: "Refactor auth middleware",
      subtitle: "Waiting on approval",
      status: "needs_approval",
      statusLabel: "Needs Approval",
    },
  ],
};

afterEach(() => {
  requireOptionalNativeModuleMock.mockReset();
});

describe("@t3tools/mobile-carplay-native", () => {
  it("falls back safely when the native module is not linked", async () => {
    requireOptionalNativeModuleMock.mockReturnValue(null);

    expect(isNativeCarPlayModuleAvailable()).toBe(false);

    const started = await startAudioSession();
    expect(started).toEqual({
      started: false,
      sampleRate: 24_000,
      channels: 1,
      echoCancellationActive: false,
      routeName: "unavailable",
    });

    await setMuted(true);
    expect(await getCarPlayStatus()).toMatchObject({
      available: false,
      connected: false,
      audioSessionActive: true,
      muted: true,
      platform: "unsupported",
    });

    await expect(enqueuePcmAudio("AAAA")).resolves.toBeUndefined();
    await expect(clearPlaybackQueue()).resolves.toBeUndefined();
    await expect(speakFallbackText("Hello from One")).resolves.toBeUndefined();
    await expect(stopFallbackSpeech()).resolves.toBeUndefined();
    await expect(updateCarPlayState(SAMPLE_STATE)).resolves.toBeUndefined();
    await expect(stopAudioSession()).resolves.toBeUndefined();

    const sub = addAudioChunkListener(() => undefined);
    expect(() => sub.remove()).not.toThrow();
    expect(() => addAudioLevelListener(() => undefined).remove()).not.toThrow();
    expect(() => addCarPlayActionListener(() => undefined).remove()).not.toThrow();
    expect(() => addCarPlayConnectionListener(() => undefined).remove()).not.toThrow();
    expect(() => addInterruptionListener(() => undefined).remove()).not.toThrow();
  });

  it("forwards audio, TTS, CarPlay state, and events to the linked native module", async () => {
    const remove = vi.fn();
    const nativeMock = {
      startAudioSession: vi.fn(async () => ({
        started: true,
        sampleRate: 24_000,
        channels: 1,
        echoCancellationActive: true,
        routeName: "CarPlay",
      })),
      stopAudioSession: vi.fn(async () => undefined),
      enqueuePcmAudio: vi.fn(async () => undefined),
      clearPlaybackQueue: vi.fn(async () => undefined),
      setMuted: vi.fn(async () => undefined),
      speakFallbackText: vi.fn(async () => undefined),
      stopFallbackSpeech: vi.fn(async () => undefined),
      updateCarPlayState: vi.fn(async () => undefined),
      getCarPlayStatus: vi.fn(async () => ({
        available: true,
        connected: true,
        audioSessionActive: true,
        muted: false,
        platform: "ios" as const,
        carPlayEntitlementExpected: true,
        audioRouteName: "CarPlay",
      })),
      addListener: vi.fn(() => ({ remove })),
    };
    requireOptionalNativeModuleMock.mockReturnValue(nativeMock);

    expect(isNativeCarPlayModuleAvailable()).toBe(true);

    const startResult = await startAudioSession({ chunkDurationMs: 80 });
    expect(startResult.started).toBe(true);
    expect(nativeMock.startAudioSession).toHaveBeenCalledWith({
      sampleRate: 24_000,
      chunkDurationMs: 80,
      enableEchoCancellation: true,
      muted: false,
    });

    await enqueuePcmAudio("AQID", 24_000);
    expect(nativeMock.enqueuePcmAudio).toHaveBeenCalledWith("AQID", 24_000);

    await clearPlaybackQueue();
    expect(nativeMock.clearPlaybackQueue).toHaveBeenCalledTimes(1);

    await setMuted(true);
    expect(nativeMock.setMuted).toHaveBeenCalledWith(true);

    await speakFallbackText("  Ready to drive.  ", { rate: 1.1 });
    expect(nativeMock.speakFallbackText).toHaveBeenCalledWith("Ready to drive.", {
      language: "en-US",
      rate: 1.1,
      pitch: 1.0,
    });

    await stopFallbackSpeech();
    expect(nativeMock.stopFallbackSpeech).toHaveBeenCalledTimes(1);

    await updateCarPlayState(SAMPLE_STATE);
    expect(nativeMock.updateCarPlayState).toHaveBeenCalledWith(SAMPLE_STATE);

    const status = await getCarPlayStatus();
    expect(status.connected).toBe(true);
    expect(status.audioRouteName).toBe("CarPlay");

    const sub = addCarPlayActionListener(() => undefined);
    expect(nativeMock.addListener).toHaveBeenCalledWith("onCarPlayAction", expect.any(Function));
    sub.remove();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
