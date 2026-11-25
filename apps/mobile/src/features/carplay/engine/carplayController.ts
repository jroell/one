import { msg } from "gt-react-native";
import { useCallback, useEffect, useSyncExternalStore } from "react";

import { m } from "../../../i18n/messages";

import { AGENT_BRIDGE_TOOLS, AgentBridgeService } from "./agentBridgeTools";
import {
  CarPlaySettingsStore,
  DEFAULT_CARPLAY_SETTINGS,
  normalizeCarPlaySettings,
} from "./carplaySettings";
import { FallbackTurnTransport } from "./fallbackTurnTransport";
import { GeminiLiveTransport } from "./geminiLiveTransport";
import { createLiveAgentBridgeBackend } from "./liveAgentBridgeBackend";
import { createNativeCarPlayAdapter } from "./nativeBridge";
import { OpenAiRealtimeTransport } from "./openaiRealtimeTransport";
import { buildPersonaInstructions, DRIVING_PERSONAS, getPersonaById } from "./personas";
import type {
  ApiKeyProvider,
  ApiKeyStatusMap,
  BridgeThreadSummary,
  CarPlayActionEvent,
  CarPlayNativeAdapter,
  CarPlaySettings,
  CarPlaySyncPayload,
  DriveControllerSnapshot,
  DriveSessionState,
  DrivingPersona,
  NativeSubscription,
  PersonaId,
  RealtimeTransport,
  TranscriptEntry,
  TransportSessionConfig,
  VoiceProfile,
  VoiceProvider,
  WebSocketFactory,
} from "./types";
import { getOrderedVoicesForCarPlay, getVoiceById, previewVoiceSample } from "./voiceCatalog";

const MAX_TRANSCRIPT_ITEMS = 80;
const MAX_RECONNECT_ATTEMPTS = 3;
const BASE_RECONNECT_DELAY_MS = 1_200;

export interface CarPlayControllerDependencies {
  readonly native?: CarPlayNativeAdapter;
  readonly settingsStore?: CarPlaySettingsStore;
  readonly agentBridge?: AgentBridgeService;
  readonly webSocketFactory?: WebSocketFactory;
  readonly fetchImpl?: typeof fetch;
  readonly createTransport?: (input: {
    readonly voice: VoiceProfile;
    readonly provider: VoiceProvider;
    readonly apiKey: string | null;
    readonly settings: CarPlaySettings;
  }) => RealtimeTransport;
  readonly now?: () => number;
}

type SnapshotListener = () => void;

export class CarPlayDriveController {
  readonly #native: CarPlayNativeAdapter;
  readonly #settingsStore: CarPlaySettingsStore;
  readonly #agentBridge: AgentBridgeService;
  readonly #webSocketFactory?: WebSocketFactory;
  readonly #fetchImpl?: typeof fetch;
  readonly #createTransportOverride?: CarPlayControllerDependencies["createTransport"];
  readonly #now: () => number;

  readonly #listeners = new Set<SnapshotListener>();
  #nativeSubscriptions: Array<NativeSubscription> = [];
  #transport: RealtimeTransport | null = null;
  #previewAbort: AbortController | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #hydrated = false;
  #hydratePromise: Promise<void> | null = null;
  #hasLiveCarPlayConnectionEvent = false;
  #transcriptSeq = 0;
  #interruptedBeforeCall = false;
  #snapshot: DriveControllerSnapshot;

  constructor(deps: CarPlayControllerDependencies = {}) {
    this.#native = deps.native ?? createNativeCarPlayAdapter();
    this.#settingsStore = deps.settingsStore ?? new CarPlaySettingsStore();
    this.#agentBridge = deps.agentBridge ?? new AgentBridgeService(createLiveAgentBridgeBackend());
    this.#webSocketFactory = deps.webSocketFactory;
    this.#fetchImpl = deps.fetchImpl;
    this.#createTransportOverride = deps.createTransport;
    this.#now = deps.now ?? (() => Date.now());

    const initialVoice = getVoiceById(DEFAULT_CARPLAY_SETTINGS.selectedVoiceId);
    const initialPersona = getPersonaById(DEFAULT_CARPLAY_SETTINGS.selectedPersonaId);

    this.#snapshot = {
      sessionState: "idle",
      isActive: false,
      isMuted: false,
      carPlayConnected: false,
      activeTransport: null,
      activeVoice: initialVoice,
      activePersona: initialPersona,
      inputLevel: 0,
      outputLevel: 0,
      activeCaption: "Ready for hands-free voice chat.",
      activeCaptionRole: "system",
      transcript: [],
      previewingVoiceId: null,
      errorMessage: null,
      reconnectAttempt: 0,
      activeThreadId: null,
      activeThreadTitle: null,
      threads: [],
      pendingConfirmation: null,
      settings: DEFAULT_CARPLAY_SETTINGS,
      apiKeysConfigured: { openai: false, gemini: false, elevenlabs: false },
    };

    this.#attachNativeListeners();
  }

  getSnapshot = (): DriveControllerSnapshot => this.#snapshot;

  subscribe = (listener: SnapshotListener): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  async hydrate(): Promise<void> {
    if (this.#hydrated) return;
    if (this.#hydratePromise) return this.#hydratePromise;

    this.#hydratePromise = (async () => {
      const [settings, apiKeysConfigured, carPlayStatus] = await Promise.all([
        this.#settingsStore.loadSettings(),
        this.#settingsStore.getApiKeyStatus(),
        this.#native.getCarPlayStatus().catch(() => ({ connected: false })),
      ]);
      const threads = this.#agentBridge.listThreads();
      this.#hydrated = true;

      this.#updateSnapshot({
        settings,
        activeVoice: getVoiceById(settings.selectedVoiceId),
        activePersona: getPersonaById(settings.selectedPersonaId),
        apiKeysConfigured,
        ...(this.#hasLiveCarPlayConnectionEvent
          ? {}
          : { carPlayConnected: carPlayStatus.connected }),
        threads,
      });
      await this.#syncCarPlay();
    })();

    try {
      await this.#hydratePromise;
    } finally {
      this.#hydratePromise = null;
    }
  }

  refreshThreads(): ReadonlyArray<BridgeThreadSummary> {
    const threads = this.#agentBridge.listThreads();
    const activeStillExists =
      this.#snapshot.activeThreadId !== null &&
      threads.some((item) => item.threadId === this.#snapshot.activeThreadId);
    this.#updateSnapshot({
      threads,
      ...(activeStillExists ? {} : { activeThreadId: null, activeThreadTitle: null }),
    });
    void this.#syncCarPlay();
    return threads;
  }

  async startSession(): Promise<void> {
    await this.hydrate();
    await this.stopPreview();
    this.#clearReconnectTimer();

    if (this.#transport) {
      await this.#teardownTransport();
    }

    const voice = this.#snapshot.activeVoice;
    const persona = this.#snapshot.activePersona;
    const threads = this.#agentBridge.listThreads();

    this.#updateSnapshot({
      sessionState: "connecting",
      isActive: true,
      isMuted: false,
      errorMessage: null,
      reconnectAttempt: 0,
      threads,
      activeCaption: `Connecting ${voice.displayName}...`,
      activeCaptionRole: "system",
    });
    await this.#syncCarPlay();

    try {
      await this.#native.startAudioSession({ sampleRate: 24_000 });
      await this.#native.setMuted(false);
      await this.#connectTransportForVoice(voice, persona);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not start hands-free voice session.";
      await this.#native.stopAudioSession().catch(() => undefined);
      this.#updateSnapshot({
        sessionState: "error",
        isActive: false,
        activeTransport: null,
        errorMessage: message,
        activeCaption: message,
        activeCaptionRole: "system",
      });
      await this.#syncCarPlay();
    }
  }

  async endSession(): Promise<void> {
    this.#clearReconnectTimer();
    await this.stopPreview();
    await this.#teardownTransport();
    await this.#native.clearPlaybackQueue().catch(() => undefined);
    await this.#native.stopFallbackSpeech().catch(() => undefined);
    await this.#native.stopAudioSession().catch(() => undefined);
    this.#agentBridge.clearPendingConfirmation();

    this.#updateSnapshot({
      sessionState: "idle",
      isActive: false,
      isMuted: false,
      activeTransport: null,
      inputLevel: 0,
      outputLevel: 0,
      reconnectAttempt: 0,
      errorMessage: null,
      pendingConfirmation: null,
      activeCaption: "Hands-free session ended.",
      activeCaptionRole: "system",
    });
    await this.#syncCarPlay();
  }

  async toggleMute(forcedMuted?: boolean): Promise<void> {
    const nextMuted = forcedMuted ?? !this.#snapshot.isMuted;
    await this.#native.setMuted(nextMuted).catch(() => undefined);
    const nextState: DriveSessionState = !this.#snapshot.isActive
      ? this.#snapshot.sessionState
      : nextMuted
        ? "muted"
        : "listening";
    this.#updateSnapshot({
      isMuted: nextMuted,
      sessionState: nextState,
      activeCaption: nextMuted ? "Microphone muted." : "Listening.",
      activeCaptionRole: "system",
    });
    await this.#syncCarPlay();
  }

  async interrupt(): Promise<void> {
    await this.#native.clearPlaybackQueue().catch(() => undefined);
    await this.#native.stopFallbackSpeech().catch(() => undefined);
    if (this.#transport) {
      this.#transport.interrupt();
    }
    if (this.#snapshot.isActive) {
      this.#updateSnapshot({
        sessionState: this.#snapshot.isMuted ? "muted" : "listening",
        outputLevel: 0,
        activeCaption: "Interrupted. Go ahead.",
        activeCaptionRole: "system",
      });
      await this.#syncCarPlay();
    }
  }

  async selectVoice(voiceId: string, options?: { readonly audition?: boolean }): Promise<void> {
    await this.hydrate();
    const voice = getVoiceById(voiceId);
    const nextSettings = await this.#settingsStore.saveSettings({
      ...this.#snapshot.settings,
      selectedVoiceId: voice.id,
    });

    this.#updateSnapshot({
      settings: nextSettings,
      activeVoice: voice,
    });

    if (this.#snapshot.isActive && this.#transport) {
      const targetProvider = await this.#resolveEffectiveProvider(voice);
      if (targetProvider === this.#transport.provider) {
        await this.#transport.updateSession(
          this.#buildSessionConfig(voice, this.#snapshot.activePersona),
        );
      } else {
        await this.#teardownTransport();
        await this.#connectTransportForVoice(voice, this.#snapshot.activePersona);
      }
      this.#appendTranscript("system", `Switched voice to ${voice.displayName}.`, true);
    } else if (options?.audition) {
      await this.previewVoice(voice.id);
    }

    await this.#syncCarPlay();
  }

  async selectPersona(personaId: PersonaId): Promise<void> {
    await this.hydrate();
    const persona = getPersonaById(personaId);
    const nextSettings = await this.#settingsStore.saveSettings({
      ...this.#snapshot.settings,
      selectedPersonaId: persona.id,
    });

    this.#updateSnapshot({
      settings: nextSettings,
      activePersona: persona,
    });

    if (this.#snapshot.isActive && this.#transport) {
      await this.#transport.updateSession(
        this.#buildSessionConfig(this.#snapshot.activeVoice, persona),
      );
      this.#appendTranscript("system", `Switched mode to ${persona.name}.`, true);
    }

    await this.#syncCarPlay();
  }

  async selectThread(threadId: string | null): Promise<void> {
    await this.hydrate();
    const threads = this.#agentBridge.listThreads();
    const matched = threadId ? (threads.find((item) => item.threadId === threadId) ?? null) : null;

    this.#updateSnapshot({
      threads,
      activeThreadId: matched?.threadId ?? null,
      activeThreadTitle: matched?.title ?? null,
    });

    if (this.#snapshot.isActive && this.#transport) {
      await this.#transport.updateSession(
        this.#buildSessionConfig(this.#snapshot.activeVoice, this.#snapshot.activePersona),
      );
      if (matched) {
        this.#transport.sendTextTurn(
          `Brief me on thread "${matched.title}" in two short spoken sentences and mention any pending approvals.`,
        );
      }
    }

    await this.#syncCarPlay();
  }

  async toggleFavoriteVoice(voiceId: string): Promise<void> {
    await this.hydrate();
    const current = this.#snapshot.settings.favoriteVoiceIds;
    const exists = current.includes(voiceId);
    const nextFavorites = exists ? current.filter((id) => id !== voiceId) : [voiceId, ...current];
    const nextSettings = await this.#settingsStore.saveSettings({
      ...this.#snapshot.settings,
      favoriteVoiceIds: nextFavorites,
    });
    this.#updateSnapshot({ settings: nextSettings });
    await this.#syncCarPlay();
  }

  async previewVoice(voiceId: string): Promise<void> {
    await this.hydrate();
    await this.stopPreview();

    const voice = getVoiceById(voiceId);
    const abort = new AbortController();
    this.#previewAbort = abort;

    this.#updateSnapshot({
      previewingVoiceId: voice.id,
      activeCaption: voice.sampleLine,
      activeCaptionRole: "assistant",
    });

    try {
      await previewVoiceSample(voice.id, {
        native: this.#native,
        getApiKey: (provider) => this.#settingsStore.getApiKey(provider),
        elevenLabsCustomVoiceId: this.#snapshot.settings.elevenLabsCustomVoiceId,
        spokenSpeed: this.#snapshot.settings.spokenSpeed,
        fetchImpl: this.#fetchImpl,
        signal: abort.signal,
      });
    } finally {
      if (this.#previewAbort === abort) {
        this.#previewAbort = null;
        this.#updateSnapshot({ previewingVoiceId: null });
      }
    }
  }

  async stopPreview(): Promise<void> {
    if (this.#previewAbort) {
      this.#previewAbort.abort();
      this.#previewAbort = null;
    }
    await this.#native.stopFallbackSpeech().catch(() => undefined);
    await this.#native.clearPlaybackQueue().catch(() => undefined);
    if (this.#snapshot.previewingVoiceId !== null) {
      this.#updateSnapshot({ previewingVoiceId: null });
    }
  }

  async updateSettings(patch: Partial<CarPlaySettings>): Promise<CarPlaySettings> {
    await this.hydrate();
    const merged = normalizeCarPlaySettings({
      ...this.#snapshot.settings,
      ...patch,
    });
    const saved = await this.#settingsStore.saveSettings(merged);
    const activeVoice = getVoiceById(saved.selectedVoiceId);
    const activePersona = getPersonaById(saved.selectedPersonaId);

    this.#updateSnapshot({
      settings: saved,
      activeVoice,
      activePersona,
    });

    if (this.#snapshot.isActive && this.#transport) {
      await this.#transport.updateSession(this.#buildSessionConfig(activeVoice, activePersona));
    }

    await this.#syncCarPlay();
    return saved;
  }

  async saveApiKey(provider: ApiKeyProvider, rawKey: string): Promise<ApiKeyStatusMap> {
    await this.hydrate();
    await this.#settingsStore.setApiKey(provider, rawKey);
    const apiKeysConfigured = await this.#settingsStore.getApiKeyStatus();
    this.#updateSnapshot({ apiKeysConfigured });
    return apiKeysConfigured;
  }

  async clearApiKey(provider: ApiKeyProvider): Promise<ApiKeyStatusMap> {
    await this.hydrate();
    await this.#settingsStore.clearApiKey(provider);
    const apiKeysConfigured = await this.#settingsStore.getApiKeyStatus();
    this.#updateSnapshot({ apiKeysConfigured });
    return apiKeysConfigured;
  }

  async sendTextPrompt(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!this.#snapshot.isActive) {
      await this.startSession();
    }
    this.#transport?.sendTextTurn(trimmed);
  }

  async confirmPendingAction(): Promise<void> {
    const result = await this.#agentBridge.confirmPendingAction();
    this.#updateSnapshot({
      pendingConfirmation: this.#agentBridge.getPendingConfirmation(),
    });
    this.#appendTranscript("tool", result.spokenSummary, true);
    if (this.#snapshot.isActive && this.#transport) {
      this.#transport.sendTextTurn(
        `The driver confirmed the pending action. Result: ${result.spokenSummary}. Briefly acknowledge in one short sentence.`,
      );
    }
    await this.#syncCarPlay();
  }

  dismissPendingAction(): void {
    this.#agentBridge.clearPendingConfirmation();
    this.#updateSnapshot({ pendingConfirmation: null });
    this.#appendTranscript("system", "Cancelled pending action.", true);
  }

  async dispatchCarPlayAction(event: CarPlayActionEvent): Promise<void> {
    switch (event.action) {
      case "start_session":
        await this.startSession();
        return;
      case "end_session":
        await this.endSession();
        return;
      case "toggle_mute":
        if (!this.#snapshot.isActive) {
          await this.startSession();
        } else {
          await this.toggleMute();
        }
        return;
      case "interrupt":
        await this.interrupt();
        return;
      case "select_voice":
        if (event.id) {
          await this.selectVoice(event.id, { audition: !this.#snapshot.isActive });
        }
        return;
      case "select_persona":
        if (event.id) {
          await this.selectPersona(event.id as PersonaId);
        }
        return;
      case "select_thread":
        if (event.id) {
          await this.selectThread(event.id);
        }
        return;
      case "next_voice": {
        const ordered = getOrderedVoicesForCarPlay(
          this.#snapshot.settings.favoriteVoiceIds,
          this.#snapshot.activeVoice.id,
        );
        const currentIndex = ordered.findIndex(
          (voice) => voice.id === this.#snapshot.activeVoice.id,
        );
        const nextVoice = ordered[(currentIndex + 1) % ordered.length];
        if (nextVoice) {
          await this.selectVoice(nextVoice.id, { audition: !this.#snapshot.isActive });
        }
        return;
      }
      case "repeat_last": {
        const lastAssistant = [...this.#snapshot.transcript]
          .reverse()
          .find((entry) => entry.role === "assistant" && entry.isFinal);
        if (lastAssistant) {
          await this.#native.speakFallbackText(lastAssistant.text, {
            rate: this.#snapshot.settings.spokenSpeed,
            voiceId: this.#snapshot.activeVoice.id,
          });
        } else if (this.#snapshot.isActive && this.#transport) {
          this.#transport.sendTextTurn("Give me a quick recap of what we were talking about.");
        }
        return;
      }
    }
  }

  dispose(): void {
    this.#clearReconnectTimer();
    for (const sub of this.#nativeSubscriptions) {
      sub.remove();
    }
    this.#nativeSubscriptions = [];
    void this.#teardownTransport();
  }

  #attachNativeListeners(): void {
    this.#nativeSubscriptions.push(
      this.#native.addAudioChunkListener((chunk) => {
        if (!this.#snapshot.isActive || this.#snapshot.isMuted || !this.#transport) return;
        this.#transport.sendAudioChunk(chunk.base64Pcm, chunk.sampleRate);
      }),
      this.#native.addAudioLevelListener((levels) => {
        if (
          Math.abs(levels.inputLevel - this.#snapshot.inputLevel) < 0.01 &&
          Math.abs(levels.outputLevel - this.#snapshot.outputLevel) < 0.01
        ) {
          return;
        }
        this.#updateSnapshot({
          inputLevel: Math.max(0, Math.min(1, levels.inputLevel)),
          outputLevel: Math.max(0, Math.min(1, levels.outputLevel)),
        });
      }),
      this.#native.addCarPlayActionListener((action) => {
        void this.dispatchCarPlayAction(action);
      }),
      this.#native.addCarPlayConnectionListener((event) => {
        this.#hasLiveCarPlayConnectionEvent = true;
        const wasConnected = this.#snapshot.carPlayConnected;
        this.#updateSnapshot({ carPlayConnected: event.connected });
        void this.#syncCarPlay();
        if (event.connected && !wasConnected) {
          void (async () => {
            await this.hydrate();
            if (
              this.#snapshot.carPlayConnected &&
              this.#snapshot.settings.autoStartOnCarPlay &&
              !this.#snapshot.isActive
            ) {
              await this.startSession();
            }
          })();
        }
      }),
      this.#native.addInterruptionListener((event) => {
        if (event.type === "began") {
          this.#interruptedBeforeCall = this.#snapshot.isActive && !this.#snapshot.isMuted;
          if (this.#snapshot.isActive) {
            void this.toggleMute(true);
            void this.#native.clearPlaybackQueue().catch(() => undefined);
          }
        } else if (event.type === "ended" && event.shouldResume && this.#interruptedBeforeCall) {
          this.#interruptedBeforeCall = false;
          if (this.#snapshot.isActive) {
            void this.toggleMute(false);
          }
        }
      }),
    );
  }

  async #resolveEffectiveProvider(voice: VoiceProfile): Promise<VoiceProvider> {
    if (voice.provider === "openai-realtime") {
      const key = await this.#settingsStore.getApiKey("openai");
      return key ? "openai-realtime" : "on-device";
    }
    if (voice.provider === "gemini-live") {
      const key = await this.#settingsStore.getApiKey("gemini");
      return key ? "gemini-live" : "on-device";
    }
    if (voice.provider === "elevenlabs") {
      const key = await this.#settingsStore.getApiKey("elevenlabs");
      return key ? "elevenlabs" : "on-device";
    }
    return "on-device";
  }

  #buildSessionConfig(voice: VoiceProfile, persona: DrivingPersona): TransportSessionConfig {
    const activeThread =
      this.#snapshot.threads.find((item) => item.threadId === this.#snapshot.activeThreadId) ??
      null;
    const toolsEnabled = this.#snapshot.settings.agentBridgeEnabled && persona.defaultToolsEnabled;
    return {
      voice,
      persona,
      instructions: buildPersonaInstructions(persona, {
        agentBridgeEnabled: toolsEnabled,
        activeThread,
        threadCount: this.#snapshot.threads.length,
      }),
      vadMode: this.#snapshot.settings.vadMode,
      bargeInEnabled: this.#snapshot.settings.bargeInEnabled,
      bargeInSensitivity: this.#snapshot.settings.bargeInSensitivity,
      spokenSpeed: this.#snapshot.settings.spokenSpeed,
      tools: toolsEnabled ? AGENT_BRIDGE_TOOLS : [],
    };
  }

  async #connectTransportForVoice(voice: VoiceProfile, persona: DrivingPersona): Promise<void> {
    const effectiveProvider = await this.#resolveEffectiveProvider(voice);
    let apiKey: string | null = null;
    if (effectiveProvider === "openai-realtime") {
      apiKey = await this.#settingsStore.getApiKey("openai");
    } else if (effectiveProvider === "gemini-live") {
      apiKey = await this.#settingsStore.getApiKey("gemini");
    } else if (effectiveProvider === "elevenlabs") {
      apiKey = await this.#settingsStore.getApiKey("elevenlabs");
    }

    const transport = this.#createTransport(voice, effectiveProvider, apiKey);
    this.#transport = transport;
    const config = this.#buildSessionConfig(voice, persona);

    await transport.connect(config, {
      onConnected: () => {
        const fellBack = effectiveProvider !== voice.provider;
        const caption = fellBack
          ? `${voice.displayName} running in On-Device mode (add API key in Voice Setup for realtime audio).`
          : `${voice.displayName} is listening.`;
        this.#updateSnapshot({
          activeTransport: effectiveProvider,
          reconnectAttempt: 0,
          errorMessage: null,
          activeCaption: caption,
          activeCaptionRole: "system",
        });
        void this.#syncCarPlay();
      },
      onStateChange: (state) => {
        if (!this.#snapshot.isActive) return;
        const resolved: DriveSessionState =
          this.#snapshot.isMuted && state === "listening" ? "muted" : state;
        this.#updateSnapshot({ sessionState: resolved });
        void this.#syncCarPlay();
      },
      onAudioDelta: (pcm24kBase64, sampleRate) => {
        void this.#native.enqueuePcmAudio(pcm24kBase64, sampleRate).catch(() => undefined);
      },
      onBargeIn: () => {
        void this.#native.clearPlaybackQueue().catch(() => undefined);
        void this.#native.stopFallbackSpeech().catch(() => undefined);
      },
      onUserTranscript: (text, isFinal) => {
        this.#upsertTranscript("user", text, isFinal);
      },
      onAssistantTranscript: (text, isFinal) => {
        this.#upsertTranscript("assistant", text, isFinal, voice.id);
      },
      onToolCall: async (name, args) => {
        const result = await this.#agentBridge.executeTool(name, args);
        this.#updateSnapshot({
          pendingConfirmation: this.#agentBridge.getPendingConfirmation(),
          threads: this.#agentBridge.listThreads(),
        });
        this.#appendTranscript("tool", result.spokenSummary, true, undefined, name);
        void this.#syncCarPlay();
        return result;
      },
      onError: (message, recoverable) => {
        this.#updateSnapshot({
          errorMessage: message,
          activeCaption: message,
          activeCaptionRole: "system",
          ...(!recoverable ? { sessionState: "error" as const, isActive: false } : {}),
        });
        void this.#syncCarPlay();
      },
      onClose: (reason, unexpected) => {
        if (!unexpected || !this.#snapshot.isActive) return;
        this.#scheduleReconnect(reason);
      },
    });
  }

  #createTransport(
    voice: VoiceProfile,
    provider: VoiceProvider,
    apiKey: string | null,
  ): RealtimeTransport {
    if (this.#createTransportOverride) {
      return this.#createTransportOverride({
        voice,
        provider,
        apiKey,
        settings: this.#snapshot.settings,
      });
    }
    if (provider === "openai-realtime" && apiKey) {
      return new OpenAiRealtimeTransport({
        apiKey,
        model: this.#snapshot.settings.openaiModel,
        webSocketFactory: this.#webSocketFactory,
      });
    }
    if (provider === "gemini-live" && apiKey) {
      return new GeminiLiveTransport({
        apiKey,
        model: this.#snapshot.settings.geminiModel,
        webSocketFactory: this.#webSocketFactory,
      });
    }
    return new FallbackTurnTransport({
      provider: provider === "elevenlabs" ? "elevenlabs" : "on-device",
      native: this.#native,
      getApiKey: (keyProvider) => this.#settingsStore.getApiKey(keyProvider),
      elevenLabsCustomVoiceId: this.#snapshot.settings.elevenLabsCustomVoiceId,
      fetchImpl: this.#fetchImpl,
    });
  }

  #scheduleReconnect(reason: string): void {
    const nextAttempt = this.#snapshot.reconnectAttempt + 1;
    if (nextAttempt > MAX_RECONNECT_ATTEMPTS) {
      this.#updateSnapshot({
        sessionState: "error",
        isActive: false,
        activeTransport: null,
        errorMessage: m(msg("Connection lost ({reason}). Tap Start to reconnect."), { reason }),
        activeCaption: m(msg("Connection lost. Tap Start to reconnect.")),
        activeCaptionRole: "system",
      });
      void this.#syncCarPlay();
      return;
    }

    this.#updateSnapshot({
      sessionState: "connecting",
      reconnectAttempt: nextAttempt,
      activeCaption: `Reconnecting (${nextAttempt}/${MAX_RECONNECT_ATTEMPTS})...`,
      activeCaptionRole: "system",
    });
    void this.#syncCarPlay();

    const delayMs = BASE_RECONNECT_DELAY_MS * 2 ** (nextAttempt - 1);
    this.#clearReconnectTimer();
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (!this.#snapshot.isActive) return;
      void this.#connectTransportForVoice(
        this.#snapshot.activeVoice,
        this.#snapshot.activePersona,
      ).catch(() => {
        this.#scheduleReconnect("Reconnect failed");
      });
    }, delayMs);
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  async #teardownTransport(): Promise<void> {
    const current = this.#transport;
    this.#transport = null;
    if (current) {
      await current.disconnect().catch(() => undefined);
    }
  }

  #upsertTranscript(
    role: "user" | "assistant",
    text: string,
    isFinal: boolean,
    voiceId?: string,
  ): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const prev = this.#snapshot.transcript;
    const last = prev[prev.length - 1];
    let nextTranscript: Array<TranscriptEntry>;
    if (last && last.role === role && !last.isFinal) {
      nextTranscript = [
        ...prev.slice(0, -1),
        {
          ...last,
          text: trimmed,
          isFinal,
          timestamp: this.#now(),
        },
      ];
    } else {
      nextTranscript = [
        ...prev,
        {
          id: `tx-${++this.#transcriptSeq}`,
          role,
          text: trimmed,
          timestamp: this.#now(),
          isFinal,
          ...(voiceId ? { voiceId } : {}),
        },
      ];
    }
    if (nextTranscript.length > MAX_TRANSCRIPT_ITEMS) {
      nextTranscript = nextTranscript.slice(-MAX_TRANSCRIPT_ITEMS);
    }

    this.#updateSnapshot({
      transcript: nextTranscript,
      activeCaption: trimmed,
      activeCaptionRole: role,
    });
    void this.#syncCarPlay();
  }

  #appendTranscript(
    role: TranscriptEntry["role"],
    text: string,
    isFinal: boolean,
    voiceId?: string,
    toolName?: string,
  ): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const next = [
      ...this.#snapshot.transcript,
      {
        id: `tx-${++this.#transcriptSeq}`,
        role,
        text: trimmed,
        timestamp: this.#now(),
        isFinal,
        ...(voiceId ? { voiceId } : {}),
        ...(toolName ? { toolName } : {}),
      },
    ].slice(-MAX_TRANSCRIPT_ITEMS);
    this.#updateSnapshot({
      transcript: next,
      activeCaption: trimmed,
      activeCaptionRole: role === "tool" ? "system" : role,
    });
  }

  async #syncCarPlay(): Promise<void> {
    const snap = this.#snapshot;
    const favoriteSet = new Set(snap.settings.favoriteVoiceIds);
    const orderedVoices = getOrderedVoicesForCarPlay(
      snap.settings.favoriteVoiceIds,
      snap.activeVoice.id,
    );

    const payload: CarPlaySyncPayload = {
      sessionState: snap.sessionState,
      isMuted: snap.isMuted,
      activeVoiceId: snap.activeVoice.id,
      activeVoiceName: snap.activeVoice.displayName,
      activePersonaId: snap.activePersona.id,
      activePersonaName: snap.activePersona.name,
      activeTopic: snap.activeThreadTitle ?? snap.activePersona.name,
      activeCaption: snap.activeCaption,
      voices: orderedVoices.map((voice) => ({
        id: voice.id,
        name: voice.displayName,
        detail: `${voice.tagline}`,
        vibe: voice.vibe,
        isFavorite: favoriteSet.has(voice.id),
        isSelected: voice.id === snap.activeVoice.id,
      })),
      personas: DRIVING_PERSONAS.map((persona) => ({
        id: persona.id,
        name: persona.name,
        detail: persona.tagline,
        isSelected: persona.id === snap.activePersona.id,
      })),
      threads: snap.threads.map((thread) => ({
        id: thread.threadId,
        title: thread.title,
        status: thread.status,
        badge: thread.lastActivityLabel,
        isSelected: thread.threadId === snap.activeThreadId,
      })),
    };

    await this.#native.updateCarPlayState(payload).catch(() => undefined);
  }

  #updateSnapshot(patch: Partial<DriveControllerSnapshot>): void {
    this.#snapshot = {
      ...this.#snapshot,
      ...patch,
    };
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

const carplayDriveController = new CarPlayDriveController();

export function useDriveController() {
  const snapshot = useSyncExternalStore(
    carplayDriveController.subscribe,
    carplayDriveController.getSnapshot,
    carplayDriveController.getSnapshot,
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hydrates persisted CarPlay settings, SecureStore key status, and live threads once on mount
  useEffect(() => {
    void carplayDriveController.hydrate();
  }, []);

  const startSession = useCallback(() => carplayDriveController.startSession(), []);
  const endSession = useCallback(() => carplayDriveController.endSession(), []);
  const toggleMute = useCallback((muted?: boolean) => carplayDriveController.toggleMute(muted), []);
  const interrupt = useCallback(() => carplayDriveController.interrupt(), []);
  const selectVoice = useCallback(
    (voiceId: string, options?: { readonly audition?: boolean }) =>
      carplayDriveController.selectVoice(voiceId, options),
    [],
  );
  const selectPersona = useCallback(
    (personaId: PersonaId) => carplayDriveController.selectPersona(personaId),
    [],
  );
  const selectThread = useCallback(
    (threadId: string | null) => carplayDriveController.selectThread(threadId),
    [],
  );
  const toggleFavoriteVoice = useCallback(
    (voiceId: string) => carplayDriveController.toggleFavoriteVoice(voiceId),
    [],
  );
  const previewVoice = useCallback(
    (voiceId: string) => carplayDriveController.previewVoice(voiceId),
    [],
  );
  const stopPreview = useCallback(() => carplayDriveController.stopPreview(), []);
  const updateSettings = useCallback(async (patch: Partial<CarPlaySettings>): Promise<void> => {
    await carplayDriveController.updateSettings(patch);
  }, []);
  const saveApiKey = useCallback(
    async (provider: ApiKeyProvider, rawKey: string): Promise<void> => {
      await carplayDriveController.saveApiKey(provider, rawKey);
    },
    [],
  );
  const clearApiKey = useCallback(async (provider: ApiKeyProvider): Promise<void> => {
    await carplayDriveController.clearApiKey(provider);
  }, []);
  const sendTextPrompt = useCallback(
    (text: string) => carplayDriveController.sendTextPrompt(text),
    [],
  );
  const confirmPendingAction = useCallback(() => carplayDriveController.confirmPendingAction(), []);
  const dismissPendingAction = useCallback(() => carplayDriveController.dismissPendingAction(), []);
  const dispatchCarPlayAction = useCallback(
    (event: CarPlayActionEvent) => carplayDriveController.dispatchCarPlayAction(event),
    [],
  );
  const refreshThreads = useCallback(() => carplayDriveController.refreshThreads(), []);

  return {
    snapshot,
    startSession,
    endSession,
    toggleMute,
    interrupt,
    selectVoice,
    selectPersona,
    selectThread,
    toggleFavoriteVoice,
    previewVoice,
    stopPreview,
    updateSettings,
    saveApiKey,
    clearApiKey,
    sendTextPrompt,
    confirmPendingAction,
    dismissPendingAction,
    dispatchCarPlayAction,
    refreshThreads,
  };
}
