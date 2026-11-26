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
      voiceControlPresented: false,
      entitlementMode: "none",
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
    listThreadsForLookup: () => [],
    getThreadDetail: () => null,
    listPendingApprovals: () => [],
    sendMessageToThread: async () => ({ ok: false }),
  }),
}));

vi.mock("../../../native/voiceTranscription", () => ({
  getLocalVoiceTranscriber: async () => null,
}));

import { AgentBridgeService, type AgentBridgeBackend } from "./agentBridgeTools";
import { CarPlayDriveController } from "./carplayController";
import { CarPlaySettingsStore, type SecureKeyValueStorage } from "./carplaySettings";
import type {
  CarPlayActionEvent,
  CarPlayNativeAdapter,
  CarPlaySyncPayload,
  DriveControllerSnapshot,
  RealtimeTransport,
  TransportCallbacks,
  TransportSessionConfig,
  VoiceProvider,
} from "./types";

function createMemoryStorage(options: { readonly failReads?: () => boolean } = {}) {
  const map = new Map<string, string>();
  const storage: SecureKeyValueStorage = {
    async getItem(key) {
      if (options.failReads?.()) throw new Error("Keychain is locked.");
      return map.get(key) ?? null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async deleteItem(key) {
      map.delete(key);
    },
  };
  return storage;
}

/** Resolves when the controller's snapshot first satisfies the predicate. */
function until(
  controller: CarPlayDriveController,
  predicate: (snapshot: DriveControllerSnapshot) => boolean,
): Promise<void> {
  return new Promise((resolve) => {
    if (predicate(controller.getSnapshot())) {
      resolve();
      return;
    }
    const unsubscribe = controller.subscribe(() => {
      if (predicate(controller.getSnapshot())) {
        unsubscribe();
        resolve();
      }
    });
  });
}

function createControllableNative(options: { readonly gateStart?: Promise<void> } = {}) {
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
  const stopWaiters: Array<() => void> = [];
  const startWaiters: Array<() => void> = [];
  // What the phone's microphone and audio session are doing, as the native module would report.
  const device = { capturing: false };

  const adapter: CarPlayNativeAdapter = {
    startAudioSession: vi.fn(async () => {
      for (const resolve of startWaiters.splice(0)) resolve();
      await options.gateStart;
      device.capturing = true;
    }),
    stopAudioSession: vi.fn(async () => {
      device.capturing = false;
      for (const resolve of stopWaiters.splice(0)) resolve();
    }),
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
    device,
    syncedPayloads,
    nextStart: () => new Promise<void>((resolve) => startWaiters.push(resolve)),
    nextStop: () => new Promise<void>((resolve) => stopWaiters.push(resolve)),
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
  needsNewSessionForVoiceChange = false;
  /** Replaces the default "connect immediately" behavior. */
  connectBehavior: ((callbacks: TransportCallbacks) => Promise<void>) | null = null;

  constructor(provider: VoiceProvider) {
    this.provider = provider;
  }

  async connect(config: TransportSessionConfig, callbacks: TransportCallbacks): Promise<void> {
    this.lastConfig = config;
    this.callbacks = callbacks;
    if (this.connectBehavior) return this.connectBehavior(callbacks);
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

  requiresNewSessionFor(): boolean {
    return this.needsNewSessionForVoiceChange;
  }

  async disconnect(): Promise<void> {
    this.disconnectCount += 1;
  }
}

const THREADS = [
  {
    environmentId: "env-1",
    threadId: "t-deploy",
    title: "Deploy CarPlay audio fix",
    status: "running" as const,
    pendingApprovalCount: 0,
    lastActivityLabel: "Running",
  },
];

function createBridgeBackend() {
  const sendMessageToThread = vi.fn(async () => ({ ok: true }));
  const listThreads = vi.fn(() => THREADS);
  const backend: AgentBridgeBackend = {
    isConnected: () => true,
    listThreads,
    listThreadsForLookup: () => THREADS,
    getThreadDetail: () => null,
    listPendingApprovals: () => [],
    sendMessageToThread,
  };
  return { backend, sendMessageToThread, listThreads };
}

function createHarness(
  options: {
    readonly storage?: SecureKeyValueStorage;
    readonly native?: ReturnType<typeof createControllableNative>;
    readonly fetchImpl?: typeof fetch;
    readonly useRealTransports?: boolean;
    readonly configureTransport?: (transport: MockTransport) => void;
  } = {},
) {
  const storage = options.storage ?? createMemoryStorage();
  const settingsStore = new CarPlaySettingsStore(storage);
  const native = options.native ?? createControllableNative();
  const transports: Array<MockTransport> = [];
  const bridge = createBridgeBackend();
  const controller = new CarPlayDriveController({
    native: native.adapter,
    settingsStore,
    agentBridge: new AgentBridgeService(bridge.backend),
    fetchImpl: options.fetchImpl,
    getLocalTranscriber: async () => null,
    ...(options.useRealTransports
      ? {}
      : {
          createTransport: ({ provider }) => {
            const transport = new MockTransport(provider);
            options.configureTransport?.(transport);
            transports.push(transport);
            return transport;
          },
        }),
  });
  return { controller, native, transports, bridge, settingsStore, storage };
}

describe("CarPlayDriveController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("manages session lifecycle, SecureStore API keys (without exposing raw keys), and CarPlay sync", async () => {
    const { controller, native, transports } = createHarness();

    await controller.hydrate();
    await controller.saveApiKey("openai", "sk-super-secret-value");

    // Snapshot reports configured status boolean only, never raw key
    const snapAfterKey = controller.getSnapshot();
    expect(snapAfterKey.apiKeysConfigured.openai).toBe(true);
    expect(JSON.stringify(snapAfterKey)).not.toContain("sk-super-secret-value");

    await controller.startSession();
    expect(controller.getSnapshot().sessionState).toBe("listening");
    expect(controller.getSnapshot().activeTransport).toBe("openai-realtime");
    expect(native.device.capturing).toBe(true);

    // Mic audio forwards while unmuted and stops when muted
    native.emitAudioChunk("AAAA");
    expect(transports[0]?.audioChunks).toEqual(["AAAA"]);

    await controller.toggleMute();
    expect(controller.getSnapshot().sessionState).toBe("muted");
    native.emitAudioChunk("BBBB");
    expect(transports[0]?.audioChunks).toEqual(["AAAA"]);

    await controller.toggleMute(false);
    expect(controller.getSnapshot().sessionState).toBe("listening");

    // Interrupt clears playback queue and signals transport
    await controller.interrupt();
    expect(native.adapter.clearPlaybackQueue).toHaveBeenCalled();
    expect(transports[0]?.interruptCount).toBe(1);

    // Mid-session OpenAI voice switch updates active session without reconnecting
    await controller.selectVoice("openai:cedar");
    expect(controller.getSnapshot().activeVoice.id).toBe("openai:cedar");
    expect(transports).toHaveLength(1);
    expect(transports[0]?.updateCount).toBe(1);

    // CarPlay synced with updated voice and threads, keyed by environment and thread
    const latestSync = native.syncedPayloads[native.syncedPayloads.length - 1];
    expect(latestSync?.activeVoiceId).toBe("openai:cedar");
    expect(latestSync?.threads).toHaveLength(1);
    expect(latestSync?.threads[0]?.id).toBe("env-1::t-deploy");

    await controller.endSession();
    expect(controller.getSnapshot().sessionState).toBe("idle");
    expect(controller.getSnapshot().isActive).toBe(false);
    expect(native.device.capturing).toBe(false);
    expect(transports[0]?.disconnectCount).toBe(1);

    controller.dispose();
  });

  it("starts a new connection for a voice change the open provider session cannot take", async () => {
    const { controller, transports } = createHarness();
    await controller.saveApiKey("openai", "sk-secret");
    await controller.startSession();
    transports[0]!.needsNewSessionForVoiceChange = true;

    await controller.selectVoice("openai:cedar");

    expect(transports).toHaveLength(2);
    expect(transports[0]!.disconnectCount).toBe(1);
    expect(transports[1]!.lastConfig?.voice.id).toBe("openai:cedar");
    expect(controller.getSnapshot().sessionState).toBe("listening");
    controller.dispose();
  });

  it("handles CarPlay steering-wheel actions and phone call interruptions", async () => {
    const { controller, native, transports } = createHarness();
    await controller.updateSettings({ autoStartOnCarPlay: true });

    // Connecting CarPlay auto-starts the session because the driver turned auto-start on
    native.emitCarPlayConnection(true);
    await until(controller, (snap) => snap.carPlayConnected && snap.sessionState === "listening");
    expect(controller.getSnapshot().isActive).toBe(true);

    // Phone call interruption mutes and clears playback, then resumes when ended
    native.emitInterruption("began", false);
    await until(controller, (snap) => snap.isMuted);

    native.emitInterruption("ended", true);
    await until(controller, (snap) => !snap.isMuted);

    // Selecting a thread from CarPlay (it echoes the key it was given) updates topic and prompts a briefing
    await controller.dispatchCarPlayAction({ action: "select_thread", id: "env-1::t-deploy" });
    expect(controller.getSnapshot().activeThreadId).toBe("t-deploy");
    expect(controller.getSnapshot().activeThreadEnvironmentId).toBe("env-1");
    expect(transports[0]?.textTurns[0]).toContain("Deploy CarPlay audio fix");
    expect(transports[0]?.textTurns[0]).toContain("env-1");

    controller.dispose();
  });

  it("does not auto-start on CarPlay connect by default, and ends only the sessions CarPlay started when it disconnects", async () => {
    const { controller, native, transports } = createHarness();

    // Nothing saved: auto-start is off.
    await controller.handleCarPlayConnection(true);
    expect(controller.getSnapshot().settings.autoStartOnCarPlay).toBe(false);
    expect(controller.getSnapshot().isActive).toBe(false);
    expect(transports).toHaveLength(0);
    await controller.handleCarPlayConnection(false);

    // Opted in: connecting starts a session and unplugging ends it, microphone included.
    await controller.updateSettings({ autoStartOnCarPlay: true });
    await controller.handleCarPlayConnection(true);
    expect(controller.getSnapshot().isActive).toBe(true);
    expect(native.device.capturing).toBe(true);
    await controller.handleCarPlayConnection(false);
    expect(controller.getSnapshot().isActive).toBe(false);
    expect(native.device.capturing).toBe(false);

    // A session the driver started on the phone survives CarPlay going away.
    await controller.handleCarPlayConnection(true);
    await controller.endSession();
    await controller.startSession();
    await controller.handleCarPlayConnection(false);
    expect(controller.getSnapshot().isActive).toBe(true);
    expect(native.device.capturing).toBe(true);

    controller.dispose();
  });

  it("does not auto-start when the saved settings cannot be read", async () => {
    let locked = false;
    const storage = createMemoryStorage({ failReads: () => locked });
    const seed = new CarPlaySettingsStore(storage);
    await seed.saveSettings({ ...(await seed.loadSettings()), autoStartOnCarPlay: true });

    locked = true;
    const { controller, native, transports } = createHarness({ storage });
    await controller.handleCarPlayConnection(true);

    expect(controller.getSnapshot().isActive).toBe(false);
    expect(transports).toHaveLength(0);
    expect(native.device.capturing).toBe(false);
    expect(controller.getSnapshot().errorMessage).toContain(
      "Could not read your saved Drive settings",
    );

    controller.dispose();
  });

  it("leaves no transport and no capture when End arrives while the microphone is still opening", async () => {
    let openMicrophone!: () => void;
    const gate = new Promise<void>((resolve) => {
      openMicrophone = resolve;
    });
    const { controller, native, transports } = createHarness({
      native: createControllableNative({ gateStart: gate }),
    });

    const nativeStarting = native.nextStart();
    const starting = controller.startSession();
    await nativeStarting;
    await controller.endSession();
    expect(controller.getSnapshot().isActive).toBe(false);

    // The permission prompt answers after End: the late start must release what it just opened.
    openMicrophone();
    await starting;

    expect(native.device.capturing).toBe(false);
    expect(transports).toHaveLength(0);
    expect(controller.getSnapshot().sessionState).toBe("idle");
    controller.dispose();
  });

  it("ignores transport callbacks from a session that ended or was replaced", async () => {
    vi.useFakeTimers();
    const { controller, native, transports } = createHarness();
    await controller.startSession();
    const old = transports[0]!.callbacks!;
    const transcriptLength = controller.getSnapshot().transcript.length;

    // A dropped connection reconnects onto a new transport; the old one is no longer current.
    old.onClose("network reset", true);
    await vi.advanceTimersByTimeAsync(1_300);
    expect(transports).toHaveLength(2);
    const replacement = transports[1]!.callbacks!;

    old.onAudioDelta("AAAA", 24_000);
    old.onUserTranscript("from the old socket", true);
    old.onClose("late close", true);
    expect(native.adapter.enqueuePcmAudio).not.toHaveBeenCalled();
    expect(controller.getSnapshot().transcript).toHaveLength(transcriptLength);
    expect(transports).toHaveLength(2);

    replacement.onAudioDelta("BBBB", 24_000);
    expect(native.adapter.enqueuePcmAudio).toHaveBeenCalledWith("BBBB", 24_000);

    // After End nothing from either transport acts, including a tool request.
    await controller.endSession();
    replacement.onAudioDelta("CCCC", 24_000);
    replacement.onUserTranscript("after end", true);
    const lateTool = await replacement.onToolCall!("list_active_threads", {});
    expect(lateTool.ok).toBe(false);
    expect(native.adapter.enqueuePcmAudio).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().transcript.some((entry) => entry.text === "after end")).toBe(
      false,
    );
    replacement.onClose("late close", true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transports).toHaveLength(2);
    expect(controller.getSnapshot().isActive).toBe(false);
    controller.dispose();
  });

  it("reconnects with bounded retries after unexpected socket close", async () => {
    vi.useFakeTimers();
    const { controller, transports } = createHarness();

    await controller.startSession();
    expect(transports).toHaveLength(1);

    // Simulate unexpected drop
    transports[0]!.callbacks?.onClose("network reset", true);
    expect(controller.getSnapshot().sessionState).toBe("connecting");
    expect(controller.getSnapshot().reconnectAttempt).toBe(1);

    await vi.advanceTimersByTimeAsync(1_300);
    expect(transports).toHaveLength(2);
    expect(controller.getSnapshot().sessionState).toBe("listening");
    expect(controller.getSnapshot().reconnectAttempt).toBe(0);

    controller.dispose();
  });

  it("releases the microphone and audio session when the retries run out, and does not refill them on brief connections", async () => {
    vi.useFakeTimers();
    const { controller, native, transports } = createHarness();
    await controller.startSession();
    expect(native.device.capturing).toBe(true);

    // Every reconnect connects and drops again at once, so none is ever usable for long.
    const released = native.nextStop();
    transports[0]!.callbacks!.onClose("drop 0", true);
    for (let attempt = 1; attempt <= 3; attempt++) {
      await vi.advanceTimersByTimeAsync(1_200 * 2 ** (attempt - 1));
      expect(transports).toHaveLength(attempt + 1);
      transports[attempt]!.callbacks!.onClose(`drop ${attempt}`, true);
    }
    await released;

    const snapshot = controller.getSnapshot();
    expect(snapshot.isActive).toBe(false);
    expect(snapshot.sessionState).toBe("error");
    expect(snapshot.errorMessage).toContain("Connection lost");
    expect(native.device.capturing).toBe(false);
    expect(transports.every((transport) => transport.disconnectCount >= 1)).toBe(true);
    controller.dispose();
  });

  it("refills the retry budget once a connection has stayed usable", async () => {
    vi.useFakeTimers();
    const { controller, transports } = createHarness();
    await controller.startSession();

    transports[0]!.callbacks!.onClose("drop", true);
    await vi.advanceTimersByTimeAsync(1_200);
    expect(controller.getSnapshot().reconnectAttempt).toBe(0);

    await vi.advanceTimersByTimeAsync(30_000);
    transports[1]!.callbacks!.onClose("drop again", true);
    // First attempt again, with the first delay.
    expect(controller.getSnapshot().reconnectAttempt).toBe(1);
    controller.dispose();
  });

  it("treats a socket that opens but never becomes usable as a failed start and releases the microphone", async () => {
    vi.useFakeTimers();
    const { controller, native, transports } = createHarness({
      configureTransport: (transport) => {
        transport.connectBehavior = () => new Promise<void>(() => undefined);
      },
    });
    const released = native.nextStop();

    const starting = controller.startSession();
    await vi.advanceTimersByTimeAsync(15_000);
    await starting;
    await released;

    expect(controller.getSnapshot().sessionState).toBe("error");
    expect(controller.getSnapshot().errorMessage).toContain("did not become ready");
    expect(native.device.capturing).toBe(false);
    expect(transports[0]!.disconnectCount).toBe(1);
    controller.dispose();
  });

  it("releases the audio session when the provider reports a failure it cannot recover from", async () => {
    const { controller, native, transports } = createHarness();
    await controller.startSession();
    const released = native.nextStop();

    transports[0]!.callbacks!.onError("Your OpenAI key was rejected.", false);
    await released;

    expect(controller.getSnapshot().sessionState).toBe("error");
    expect(controller.getSnapshot().isActive).toBe(false);
    expect(native.device.capturing).toBe(false);
    expect(transports[0]!.disconnectCount).toBe(1);
    controller.dispose();
  });

  it("refuses agent tools the moment the bridge is turned off and drops the proposal that was waiting", async () => {
    const { controller, transports, bridge } = createHarness();
    await controller.startSession();
    const callbacks = transports[0]!.callbacks!;

    const proposed = await callbacks.onToolCall!("send_message_to_thread", {
      threadId: "t-deploy",
      message: "Run the smoke test",
      confirmed: true,
    });
    expect(proposed.status).toBe("needs_confirmation");
    expect(controller.getSnapshot().pendingConfirmation?.message).toBe("Run the smoke test");
    expect(bridge.sendMessageToThread).not.toHaveBeenCalled();

    await controller.updateSettings({ agentBridgeEnabled: false });
    expect(controller.getSnapshot().pendingConfirmation).toBeNull();

    // The provider session still lists the tools it was told about at connect; none of them run.
    const listed = await callbacks.onToolCall!("list_active_threads", {});
    expect(listed.ok).toBe(false);
    expect(listed.spokenSummary).toContain("turned off");
    const again = await callbacks.onToolCall!("send_message_to_thread", {
      threadId: "t-deploy",
      message: "Run the smoke test",
    });
    expect(again.ok).toBe(false);
    expect(controller.getSnapshot().pendingConfirmation).toBeNull();
    expect(bridge.sendMessageToThread).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("refuses agent tools in a mode that has them off", async () => {
    const { controller, transports } = createHarness();
    await controller.startSession();
    await controller.selectPersona("brainstorm");

    const result = await transports[0]!.callbacks!.onToolCall!("list_active_threads", {});
    expect(result.ok).toBe(false);
    controller.dispose();
  });

  it("sends only when the tap carries the id of the proposal on screen, and clears an expired proposal from the screen", async () => {
    vi.useFakeTimers();
    const { controller, transports, bridge } = createHarness();
    await controller.startSession();
    const callbacks = transports[0]!.callbacks!;

    await callbacks.onToolCall!("send_message_to_thread", {
      threadId: "t-deploy",
      message: "First message",
    });
    const first = controller.getSnapshot().pendingConfirmation!;
    await callbacks.onToolCall!("send_message_to_thread", {
      threadId: "t-deploy",
      message: "Second message",
    });
    const second = controller.getSnapshot().pendingConfirmation!;
    expect(second.id).not.toBe(first.id);

    // A tap on the card that was replaced sends nothing and leaves the current card up.
    await controller.confirmPendingAction(first.id);
    expect(bridge.sendMessageToThread).not.toHaveBeenCalled();
    expect(controller.getSnapshot().pendingConfirmation?.id).toBe(second.id);

    await controller.confirmPendingAction(second.id);
    expect(bridge.sendMessageToThread).toHaveBeenCalledTimes(1);
    expect(bridge.sendMessageToThread).toHaveBeenCalledWith(
      { environmentId: "env-1", threadId: "t-deploy" },
      "Second message",
    );
    expect(controller.getSnapshot().pendingConfirmation).toBeNull();

    // An unanswered proposal disappears from the screen when it expires.
    await callbacks.onToolCall!("send_message_to_thread", {
      threadId: "t-deploy",
      message: "Third message",
    });
    expect(controller.getSnapshot().pendingConfirmation).not.toBeNull();
    await vi.advanceTimersByTimeAsync(91_000);
    expect(controller.getSnapshot().pendingConfirmation).toBeNull();
    controller.dispose();
  });

  it("ends a session that uses a provider key when that key is replaced or cleared, and leaves unrelated sessions alone", async () => {
    const { controller, native, transports } = createHarness();
    await controller.saveApiKey("openai", "sk-secret");
    await controller.startSession();
    expect(transports[0]!.provider).toBe("openai-realtime");

    await controller.saveApiKey("gemini", "AIza-other");
    expect(controller.getSnapshot().isActive).toBe(true);

    await controller.clearApiKey("openai");
    expect(controller.getSnapshot().isActive).toBe(false);
    expect(controller.getSnapshot().activeCaption).toContain("OpenAI key changed");
    expect(transports[0]!.disconnectCount).toBe(1);
    expect(native.device.capturing).toBe(false);

    // Replacing a key ends the session too.
    await controller.saveApiKey("openai", "sk-first");
    await controller.startSession();
    await controller.saveApiKey("openai", "sk-second");
    expect(controller.getSnapshot().isActive).toBe(false);
    expect(native.device.capturing).toBe(false);
    controller.dispose();
  });

  it("keeps an On-Device session from uploading microphone audio even though an OpenAI key is saved, and says it cannot hear", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    const { controller, native } = createHarness({
      useRealTransports: true,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });
    await controller.saveApiKey("openai", "sk-secret");
    await controller.selectVoice("on-device:pilot");
    await controller.startSession();

    const snapshot = controller.getSnapshot();
    expect(snapshot.activeTransport).toBe("on-device");
    expect(snapshot.sessionState).not.toBe("listening");
    expect(snapshot.voiceInputUnavailableMessage).toContain("cannot hear you");
    expect(snapshot.errorMessage).toBe(snapshot.voiceInputUnavailableMessage);
    expect(native.adapter.setMuted).toHaveBeenLastCalledWith(true);

    // Loud microphone audio followed by silence would commit a turn if anything were listening.
    const loud = "AAAA".repeat(1_600);
    for (let i = 0; i < 10; i++) native.emitAudioChunk(loud);
    expect(fetchMock).not.toHaveBeenCalled();

    await controller.toggleMute(false);
    expect(controller.getSnapshot().sessionState).not.toBe("listening");
    controller.dispose();
  });
});
