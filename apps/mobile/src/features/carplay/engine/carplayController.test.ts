import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("expo-audio", () => ({
  getRecordingPermissionsAsync: vi.fn(async () => ({ granted: true })),
  requestRecordingPermissionsAsync: vi.fn(async () => ({ granted: true })),
}));

vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));

vi.mock("@t3tools/mobile-carplay-native", () => {
  const noop = { remove: () => undefined };
  return {
    startAudioSession: vi.fn(async () => ({
      started: false,
      sampleRate: 24_000,
      channels: 1,
      echoCancellationActive: false,
      routeName: "unavailable",
    })),
    stopAudioSession: vi.fn(async () => undefined),
    enqueuePcmAudio: vi.fn(async () => undefined),
    clearPlaybackQueue: vi.fn(async () => undefined),
    setMuted: vi.fn(async () => undefined),
    speakFallbackText: vi.fn(async () => undefined),
    stopFallbackSpeech: vi.fn(async () => undefined),
    updateCarPlayState: vi.fn(async () => undefined),
    getCarPlayStatus: vi.fn(async () => ({
      available: false,
      connected: false,
      audioSessionActive: false,
      muted: false,
      platform: "unsupported",
      carPlayEntitlementExpected: false,
      audioRouteName: "unavailable",
    })),
    addAudioChunkListener: vi.fn(() => noop),
    addAudioLevelListener: vi.fn(() => noop),
    addCarPlayActionListener: vi.fn(() => noop),
    addCarPlayConnectionListener: vi.fn(() => noop),
    addInterruptionListener: vi.fn(() => noop),
  };
});

vi.mock("./liveAgentBridgeBackend", () => ({
  createLiveAgentBridgeBackend: () => ({
    isConnected: () => false,
    listThreads: () => [],
    getThreadDetail: () => null,
    listPendingApprovals: () => [],
    sendMessageToThread: async () => ({ ok: false }),
    respondToApproval: async () => ({ ok: false }),
  }),
}));

import { AgentBridgeService, type AgentBridgeBackend } from "./agentBridgeTools";
import { CarPlayDriveController } from "./carplayController";
import { CarPlaySettingsStore, type SecureKeyValueStorage } from "./carplaySettings";
import type {
  CarPlayActionEvent,
  CarPlayNativeAdapter,
  CarPlaySyncPayload,
  RealtimeTransport,
  TransportCallbacks,
  TransportSessionConfig,
  VoiceProvider,
} from "./types";

function createMemoryStorage(): SecureKeyValueStorage {
  const map = new Map<string, string>();
  return {
    async getItem(key) {
      return map.get(key) ?? null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async deleteItem(key) {
      map.delete(key);
    },
  };
}

function createControllableNative() {
  let audioChunkCb:
    | ((event: { readonly base64Pcm: string; readonly sampleRate: number }) => void)
    | null = null;
  let audioLevelCb:
    | ((event: { readonly inputLevel: number; readonly outputLevel: number }) => void)
    | null = null;
  let carPlayActionCb: ((event: CarPlayActionEvent) => void) | null = null;
  let carPlayConnCb: ((event: { readonly connected: boolean }) => void) | null = null;
  let interruptionCb:
    | ((event: { readonly type: "began" | "ended"; readonly shouldResume?: boolean }) => void)
    | null = null;

  const syncedPayloads: Array<CarPlaySyncPayload> = [];

  const adapter: CarPlayNativeAdapter = {
    startAudioSession: vi.fn(async () => undefined),
    stopAudioSession: vi.fn(async () => undefined),
    enqueuePcmAudio: vi.fn(async () => undefined),
    clearPlaybackQueue: vi.fn(async () => undefined),
    setMuted: vi.fn(async () => undefined),
    speakFallbackText: vi.fn(async () => undefined),
    stopFallbackSpeech: vi.fn(async () => undefined),
    updateCarPlayState: vi.fn(async (payload: CarPlaySyncPayload) => {
      syncedPayloads.push(payload);
    }),
    getCarPlayStatus: vi.fn(async () => ({ connected: false })),
    addAudioChunkListener: vi.fn(
      (cb: (event: { readonly base64Pcm: string; readonly sampleRate: number }) => void) => {
        audioChunkCb = cb;
        return {
          remove: () => {
            audioChunkCb = null;
          },
        };
      },
    ),
    addAudioLevelListener: vi.fn(
      (cb: (event: { readonly inputLevel: number; readonly outputLevel: number }) => void) => {
        audioLevelCb = cb;
        return {
          remove: () => {
            audioLevelCb = null;
          },
        };
      },
    ),
    addCarPlayActionListener: vi.fn((cb: (event: CarPlayActionEvent) => void) => {
      carPlayActionCb = cb;
      return {
        remove: () => {
          carPlayActionCb = null;
        },
      };
    }),
    addCarPlayConnectionListener: vi.fn((cb: (event: { readonly connected: boolean }) => void) => {
      carPlayConnCb = cb;
      return {
        remove: () => {
          carPlayConnCb = null;
        },
      };
    }),
    addInterruptionListener: vi.fn(
      (
        cb: (event: { readonly type: "began" | "ended"; readonly shouldResume?: boolean }) => void,
      ) => {
        interruptionCb = cb;
        return {
          remove: () => {
            interruptionCb = null;
          },
        };
      },
    ),
  };

  return {
    adapter,
    syncedPayloads,
    emitAudioChunk: (base64Pcm: string, sampleRate = 24_000) =>
      audioChunkCb?.({ base64Pcm, sampleRate }),
    emitAudioLevel: (inputLevel: number, outputLevel: number) =>
      audioLevelCb?.({ inputLevel, outputLevel }),
    emitCarPlayAction: (event: CarPlayActionEvent) => carPlayActionCb?.(event),
    emitCarPlayConnection: (connected: boolean) => carPlayConnCb?.({ connected }),
    emitInterruption: (type: "began" | "ended", shouldResume = true) =>
      interruptionCb?.({ type, shouldResume }),
  };
}

class MockTransport implements RealtimeTransport {
  readonly provider: VoiceProvider;
  callbacks: TransportCallbacks | null = null;
  lastConfig: TransportSessionConfig | null = null;
  readonly audioChunks: Array<string> = [];
  readonly textTurns: Array<string> = [];
  interruptCount = 0;
  updateCount = 0;
  disconnectCount = 0;

  constructor(provider: VoiceProvider) {
    this.provider = provider;
  }

  async connect(config: TransportSessionConfig, callbacks: TransportCallbacks): Promise<void> {
    this.lastConfig = config;
    this.callbacks = callbacks;
    callbacks.onConnected();
    callbacks.onStateChange("listening");
  }

  sendAudioChunk(pcm24kBase64: string): void {
    this.audioChunks.push(pcm24kBase64);
  }

  sendTextTurn(text: string): void {
    this.textTurns.push(text);
  }

  interrupt(): void {
    this.interruptCount += 1;
    this.callbacks?.onBargeIn();
  }

  async updateSession(patch: Partial<TransportSessionConfig>): Promise<void> {
    this.updateCount += 1;
    if (this.lastConfig) {
      this.lastConfig = { ...this.lastConfig, ...patch };
    }
  }

  async disconnect(): Promise<void> {
    this.disconnectCount += 1;
  }
}

function createBridgeBackend(): AgentBridgeBackend {
  return {
    isConnected: () => true,
    listThreads: () => [
      {
        environmentId: "env-1",
        threadId: "t-deploy",
        title: "Deploy CarPlay audio fix",
        status: "running",
        pendingApprovalCount: 0,
        lastActivityLabel: "Running",
      },
    ],
    getThreadDetail: () => null,
    listPendingApprovals: () => [],
    sendMessageToThread: vi.fn(async () => ({ ok: true })),
    respondToApproval: vi.fn(async () => ({ ok: true })),
  };
}

describe("CarPlayDriveController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("manages session lifecycle, SecureStore API keys (without exposing raw keys), and CarPlay sync", async () => {
    const storage = createMemoryStorage();
    const settingsStore = new CarPlaySettingsStore(storage);
    const native = createControllableNative();
    const createdTransports: Array<MockTransport> = [];

    const controller = new CarPlayDriveController({
      native: native.adapter,
      settingsStore,
      agentBridge: new AgentBridgeService(createBridgeBackend()),
      createTransport: ({ provider }) => {
        const transport = new MockTransport(provider);
        createdTransports.push(transport);
        return transport;
      },
      now: () => 10_000,
    });

    await controller.hydrate();
    await controller.saveApiKey("openai", "sk-super-secret-value");

    // Snapshot reports configured status boolean only, never raw key
    const snapAfterKey = controller.getSnapshot();
    expect(snapAfterKey.apiKeysConfigured.openai).toBe(true);
    expect(JSON.stringify(snapAfterKey)).not.toContain("sk-super-secret-value");

    await controller.startSession();
    expect(controller.getSnapshot().sessionState).toBe("listening");
    expect(controller.getSnapshot().activeTransport).toBe("openai-realtime");
    expect(native.adapter.startAudioSession).toHaveBeenCalledTimes(1);

    // Mic audio forwards while unmuted and stops when muted
    native.emitAudioChunk("AAAA");
    expect(createdTransports[0]?.audioChunks).toEqual(["AAAA"]);

    await controller.toggleMute();
    expect(controller.getSnapshot().sessionState).toBe("muted");
    native.emitAudioChunk("BBBB");
    expect(createdTransports[0]?.audioChunks).toEqual(["AAAA"]);

    await controller.toggleMute(false);
    expect(controller.getSnapshot().sessionState).toBe("listening");

    // Interrupt clears playback queue and signals transport
    await controller.interrupt();
    expect(native.adapter.clearPlaybackQueue).toHaveBeenCalled();
    expect(createdTransports[0]?.interruptCount).toBe(1);

    // Mid-session OpenAI voice switch updates active session without reconnecting
    await controller.selectVoice("openai:cedar");
    expect(controller.getSnapshot().activeVoice.id).toBe("openai:cedar");
    expect(createdTransports).toHaveLength(1);
    expect(createdTransports[0]?.updateCount).toBe(1);

    // CarPlay synced with updated voice and threads
    const latestSync = native.syncedPayloads[native.syncedPayloads.length - 1];
    expect(latestSync?.activeVoiceId).toBe("openai:cedar");
    expect(latestSync?.threads).toHaveLength(1);

    await controller.endSession();
    expect(controller.getSnapshot().sessionState).toBe("idle");
    expect(controller.getSnapshot().isActive).toBe(false);
    expect(native.adapter.stopAudioSession).toHaveBeenCalledTimes(1);

    controller.dispose();
  });

  it("handles CarPlay steering-wheel actions, auto-start on CarPlay connect, and phone call interruptions", async () => {
    const native = createControllableNative();
    const createdTransports: Array<MockTransport> = [];

    const controller = new CarPlayDriveController({
      native: native.adapter,
      settingsStore: new CarPlaySettingsStore(createMemoryStorage()),
      agentBridge: new AgentBridgeService(createBridgeBackend()),
      createTransport: ({ provider }) => {
        const transport = new MockTransport(provider);
        createdTransports.push(transport);
        return transport;
      },
      now: () => 20_000,
    });

    await controller.hydrate();

    // Connecting CarPlay auto-starts session because autoStartOnCarPlay defaults true
    native.emitCarPlayConnection(true);
    await vi.waitFor(() => {
      expect(controller.getSnapshot().carPlayConnected).toBe(true);
      expect(controller.getSnapshot().isActive).toBe(true);
    });

    // Phone call interruption mutes and clears playback, then resumes when ended
    native.emitInterruption("began", false);
    await vi.waitFor(() => expect(controller.getSnapshot().isMuted).toBe(true));

    native.emitInterruption("ended", true);
    await vi.waitFor(() => expect(controller.getSnapshot().isMuted).toBe(false));

    // Selecting a thread from CarPlay updates topic and prompts a briefing
    native.emitCarPlayAction({ action: "select_thread", id: "t-deploy" });
    await vi.waitFor(() => {
      expect(controller.getSnapshot().activeThreadId).toBe("t-deploy");
    });
    expect(createdTransports[0]?.textTurns[0]).toContain("Deploy CarPlay audio fix");

    controller.dispose();
  });

  it("respects persisted autoStartOnCarPlay false when CarPlay connects before hydration finishes", async () => {
    const storage = createMemoryStorage();
    const settingsStore = new CarPlaySettingsStore(storage);
    await settingsStore.saveSettings({
      ...(await settingsStore.loadSettings()),
      autoStartOnCarPlay: false,
    });

    const native = createControllableNative();
    const createdTransports: Array<MockTransport> = [];
    const controller = new CarPlayDriveController({
      native: native.adapter,
      settingsStore,
      agentBridge: new AgentBridgeService(createBridgeBackend()),
      createTransport: ({ provider }) => {
        const transport = new MockTransport(provider);
        createdTransports.push(transport);
        return transport;
      },
      now: () => 25_000,
    });

    // Fire CarPlay connect immediately before hydrate() has run
    native.emitCarPlayConnection(true);
    await controller.hydrate();
    await Promise.resolve();

    expect(controller.getSnapshot().carPlayConnected).toBe(true);
    expect(controller.getSnapshot().settings.autoStartOnCarPlay).toBe(false);
    expect(controller.getSnapshot().isActive).toBe(false);
    expect(createdTransports).toHaveLength(0);

    controller.dispose();
  });

  it("reconnects with bounded retries after unexpected socket close", async () => {
    vi.useFakeTimers();
    const native = createControllableNative();
    const createdTransports: Array<MockTransport> = [];

    const controller = new CarPlayDriveController({
      native: native.adapter,
      settingsStore: new CarPlaySettingsStore(createMemoryStorage()),
      agentBridge: new AgentBridgeService(createBridgeBackend()),
      createTransport: ({ provider }) => {
        const transport = new MockTransport(provider);
        createdTransports.push(transport);
        return transport;
      },
      now: () => 30_000,
    });

    await controller.startSession();
    expect(createdTransports).toHaveLength(1);

    // Simulate unexpected drop
    createdTransports[0]!.callbacks?.onClose("network reset", true);
    expect(controller.getSnapshot().sessionState).toBe("connecting");
    expect(controller.getSnapshot().reconnectAttempt).toBe(1);

    await vi.advanceTimersByTimeAsync(1_300);
    expect(createdTransports).toHaveLength(2);
    expect(controller.getSnapshot().sessionState).toBe("listening");
    expect(controller.getSnapshot().reconnectAttempt).toBe(0);

    controller.dispose();
  });
});
