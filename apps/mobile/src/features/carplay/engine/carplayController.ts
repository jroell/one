import { msg } from "gt-react-native";
import { useCallback, useEffect, useSyncExternalStore } from "react";

import { m } from "../../../i18n/messages";

import { AGENT_BRIDGE_TOOLS, AgentBridgeService, bridgeThreadKey } from "./agentBridgeTools";
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
import { createLocalPcmTranscriber, type PcmTranscriber } from "./speechInput";
import type {
  ApiKeyProvider,
  ApiKeyStatusMap,
  BridgeThreadRef,
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
  TransportCallbacks,
  TransportSessionConfig,
  VoiceProfile,
  VoiceProvider,
  VoiceToolExecutionResult,
  WebSocketFactory,
} from "./types";
import { getOrderedVoicesForCarPlay, getVoiceById, previewVoiceSample } from "./voiceCatalog";

const MAX_TRANSCRIPT_ITEMS = 80;
const MAX_RECONNECT_ATTEMPTS = 3;
const BASE_RECONNECT_DELAY_MS = 1_200;
/** A socket that opens but never becomes a usable session counts as a failed attempt. */
const CONNECT_DEADLINE_MS = 15_000;
/** The retry budget refills only after a connection has stayed usable this long. */
const STABLE_SESSION_MS = 30_000;
const MIN_PROPOSAL_TIMER_MS = 250;

/** Who asked for the session. A session CarPlay started ends when CarPlay disconnects. */
type SessionOwner = "phone" | "carplay";

const KEY_PROVIDERS_BY_TRANSPORT: Readonly<Record<VoiceProvider, ReadonlyArray<ApiKeyProvider>>> = {
  "openai-realtime": ["openai"],
  "gemini-live": ["gemini"],
  elevenlabs: ["elevenlabs", "openai", "gemini"],
  // On-Device sends nothing to a cloud provider, so no saved key is in use.
  "on-device": [],
};

const KEY_PROVIDER_NAMES: Readonly<Record<ApiKeyProvider, string>> = {
  openai: "OpenAI",
  gemini: "Gemini",
  elevenlabs: "ElevenLabs",
};

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
  /** The phone's own speech recognizer for the On-Device and ElevenLabs voices. */
  readonly getLocalTranscriber?: (signal: AbortSignal) => Promise<PcmTranscriber | null>;
  readonly now?: () => number;
}

type SnapshotListener = () => void;

function refusal(spokenSummary: string): VoiceToolExecutionResult {
  return { ok: false, status: "error", spokenSummary };
}

export class CarPlayDriveController {
  readonly #native: CarPlayNativeAdapter;
  readonly #settingsStore: CarPlaySettingsStore;
  readonly #agentBridge: AgentBridgeService;
  readonly #webSocketFactory?: WebSocketFactory;
  readonly #fetchImpl?: typeof fetch;
  readonly #createTransportOverride?: CarPlayControllerDependencies["createTransport"];
  readonly #getLocalTranscriber: (signal: AbortSignal) => Promise<PcmTranscriber | null>;
  readonly #now: () => number;

  readonly #listeners = new Set<SnapshotListener>();
  #nativeSubscriptions: Array<NativeSubscription> = [];
  #transport: RealtimeTransport | null = null;
  #previewAbort: AbortController | null = null;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #stableTimer: ReturnType<typeof setTimeout> | null = null;
  #proposalTimer: ReturnType<typeof setTimeout> | null = null;
  #hydrated = false;
  #hydratePromise: Promise<void> | null = null;
  #settingsReadFailed = false;
  #hasLiveCarPlayConnectionEvent = false;
  #transcriptSeq = 0;
  #interruptedBeforeCall = false;
  /**
   * Bumped by every start and by every end. Each async step and transport callback compares the
   * number it captured with this one and does nothing when they differ.
   */
  #generation = 0;
  /** Null while no session is wanted, so a start that finishes late knows to release the audio. */
  #sessionOwner: SessionOwner | null = null;
  #retryCount = 0;
  #snapshot: DriveControllerSnapshot;

  constructor(deps: CarPlayControllerDependencies = {}) {
    this.#native = deps.native ?? createNativeCarPlayAdapter();
    this.#settingsStore = deps.settingsStore ?? new CarPlaySettingsStore();
    this.#agentBridge = deps.agentBridge ?? new AgentBridgeService(createLiveAgentBridgeBackend());
    this.#webSocketFactory = deps.webSocketFactory;
    this.#fetchImpl = deps.fetchImpl;
    this.#createTransportOverride = deps.createTransport;
    this.#getLocalTranscriber = deps.getLocalTranscriber ?? createLocalPcmTranscriber;
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
      activeThreadEnvironmentId: null,
      activeThreadTitle: null,
      voiceInputUnavailableMessage: null,
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
      const [settingsRead, apiKeysConfigured, carPlayStatus] = await Promise.all([
        this.#settingsStore.loadSettings().then(
          (settings) => ({ readable: true as const, settings }),
          () => ({ readable: false as const, settings: DEFAULT_CARPLAY_SETTINGS }),
        ),
        this.#settingsStore
          .getApiKeyStatus()
          .catch(() => ({ openai: false, gemini: false, elevenlabs: false })),
        this.#native.getCarPlayStatus().catch(() => ({ connected: false })),
      ]);
      const threads = this.#agentBridge.listThreads();
      // An unreadable store (for example a locked phone) must not look like "no opt-out saved".
      this.#settingsReadFailed = !settingsRead.readable;
      const settings = settingsRead.readable
        ? settingsRead.settings
        : { ...DEFAULT_CARPLAY_SETTINGS, autoStartOnCarPlay: false };
      this.#hydrated = settingsRead.readable;

      this.#updateSnapshot({
        settings,
        activeVoice: getVoiceById(settings.selectedVoiceId),
        activePersona: getPersonaById(settings.selectedPersonaId),
        apiKeysConfigured,
        ...(this.#hasLiveCarPlayConnectionEvent
          ? {}
          : { carPlayConnected: carPlayStatus.connected }),
        ...(settingsRead.readable || this.#snapshot.isActive
          ? {}
          : {
              errorMessage: m(
                msg(
                  "Could not read your saved Drive settings. Defaults are in use and auto-start is off.",
                ),
              ),
            }),
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
      threads.some(
        (item) =>
          item.threadId === this.#snapshot.activeThreadId &&
          item.environmentId === this.#snapshot.activeThreadEnvironmentId,
      );
    this.#updateSnapshot({
      threads,
      ...(activeStillExists
        ? {}
        : { activeThreadId: null, activeThreadEnvironmentId: null, activeThreadTitle: null }),
    });
    void this.#syncCarPlay();
    return threads;
  }

  async startSession(owner: SessionOwner = "phone"): Promise<void> {
    const generation = ++this.#generation;
    this.#sessionOwner = owner;
    this.#retryCount = 0;
    this.#clearReconnectTimer();
    this.#clearStableTimer();

    try {
      await this.hydrate();
      if (generation !== this.#generation) return;

      const voice = this.#snapshot.activeVoice;
      const persona = this.#snapshot.activePersona;
      this.#updateSnapshot({
        sessionState: "connecting",
        isActive: true,
        isMuted: false,
        errorMessage: null,
        voiceInputUnavailableMessage: null,
        reconnectAttempt: 0,
        threads: this.#agentBridge.listThreads(),
        activeCaption: `Connecting ${voice.displayName}...`,
        activeCaptionRole: "system",
      });

      await this.stopPreview();
      if (generation !== this.#generation) return;
      if (this.#transport) {
        await this.#teardownTransport();
        if (generation !== this.#generation) return;
      }
      await this.#syncCarPlay();
      if (generation !== this.#generation) return;

      await this.#native.startAudioSession({ sampleRate: 24_000 });
      if (generation !== this.#generation) {
        await this.#releaseAudioIfNoSessionWanted();
        return;
      }
      await this.#native.setMuted(false);
      if (generation !== this.#generation) {
        await this.#releaseAudioIfNoSessionWanted();
        return;
      }
      await this.#connectTransportForVoice(generation, voice, persona);
    } catch (error) {
      if (generation !== this.#generation) {
        await this.#releaseAudioIfNoSessionWanted();
        return;
      }
      const message =
        error instanceof Error && error.message
          ? error.message
          : m(msg("Could not start hands-free voice session."));
      await this.#closeSession({
        sessionState: "error",
        errorMessage: message,
        activeCaption: message,
        activeCaptionRole: "system",
      });
    }
  }

  async endSession(): Promise<void> {
    await this.#closeSession({
      sessionState: "idle",
      errorMessage: null,
      activeCaption: "Hands-free session ended.",
      activeCaptionRole: "system",
    });
  }

  async toggleMute(forcedMuted?: boolean): Promise<void> {
    const nextMuted = forcedMuted ?? !this.#snapshot.isMuted;
    // A session that cannot hear keeps the native microphone off whatever the toggle says.
    const nativeMuted = nextMuted || this.#snapshot.voiceInputUnavailableMessage !== null;
    await this.#native.setMuted(nativeMuted).catch(() => undefined);
    const nextState: DriveSessionState = !this.#snapshot.isActive
      ? this.#snapshot.sessionState
      : nextMuted
        ? "muted"
        : this.#restingSessionState();
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
        sessionState: this.#snapshot.isMuted ? "muted" : this.#restingSessionState(),
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

    const transport = this.#transport;
    if (this.#snapshot.isActive && transport) {
      const generation = this.#generation;
      try {
        const targetProvider = await this.#resolveEffectiveProvider(voice);
        if (generation !== this.#generation || this.#transport !== transport) return;
        const persona = this.#snapshot.activePersona;
        if (
          targetProvider === transport.provider &&
          !transport.requiresNewSessionFor?.({ voice })
        ) {
          await transport.updateSession(this.#buildSessionConfig(voice, persona));
        } else {
          await this.#teardownTransport();
          await this.#connectTransportForVoice(generation, voice, persona);
        }
        if (generation !== this.#generation) return;
        this.#appendTranscript("system", `Switched voice to ${voice.displayName}.`, true);
      } catch {
        if (generation === this.#generation) {
          this.#scheduleReconnect(generation, m(msg("Voice switch failed")));
        }
        return;
      }
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
    this.#dropProposalIfToolsOff();

    if (this.#snapshot.isActive && this.#transport) {
      await this.#transport.updateSession(
        this.#buildSessionConfig(this.#snapshot.activeVoice, persona),
      );
      this.#appendTranscript("system", `Switched mode to ${persona.name}.`, true);
    }

    await this.#syncCarPlay();
  }

  async selectThread(ref: BridgeThreadRef | null): Promise<void> {
    await this.hydrate();
    const threads = this.#agentBridge.listThreads();
    const matched = ref
      ? (threads.find(
          (item) => item.threadId === ref.threadId && item.environmentId === ref.environmentId,
        ) ?? null)
      : null;

    this.#updateSnapshot({
      threads,
      activeThreadId: matched?.threadId ?? null,
      activeThreadEnvironmentId: matched?.environmentId ?? null,
      activeThreadTitle: matched?.title ?? null,
    });

    if (this.#snapshot.isActive && this.#transport) {
      await this.#transport.updateSession(
        this.#buildSessionConfig(this.#snapshot.activeVoice, this.#snapshot.activePersona),
      );
      if (matched) {
        this.#transport.sendTextTurn(
          `Brief me on thread "${matched.title}" (environmentId ${matched.environmentId}, threadId ${matched.threadId}) in two short spoken sentences and mention any pending approvals.`,
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
    this.#dropProposalIfToolsOff();

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
    await this.#endSessionUsingKey(provider);
    return apiKeysConfigured;
  }

  async clearApiKey(provider: ApiKeyProvider): Promise<ApiKeyStatusMap> {
    await this.hydrate();
    await this.#settingsStore.clearApiKey(provider);
    const apiKeysConfigured = await this.#settingsStore.getApiKeyStatus();
    this.#updateSnapshot({ apiKeysConfigured });
    await this.#endSessionUsingKey(provider);
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

  /**
   * The driver tapped Send on the phone. `proposalId` is the id on the card they saw, so a card
   * that was replaced, expired or already used sends nothing.
   */
  async confirmPendingAction(proposalId: string): Promise<void> {
    const result = await this.#agentBridge.confirmProposal(proposalId);
    this.#syncPendingConfirmation();
    this.#appendTranscript("tool", result.spokenSummary, true);
    if (result.ok && this.#snapshot.isActive && this.#transport) {
      this.#transport.sendTextTurn(
        `The driver tapped Send. Result: ${result.spokenSummary} Briefly acknowledge in one short sentence.`,
      );
    }
    await this.#syncCarPlay();
  }

  dismissPendingAction(proposalId: string): void {
    if (!this.#agentBridge.dismissProposal(proposalId)) return;
    this.#syncPendingConfirmation();
    this.#appendTranscript("system", m(msg("Cancelled the pending message.")), true);
  }

  async dispatchCarPlayAction(event: CarPlayActionEvent): Promise<void> {
    switch (event.action) {
      case "start_session":
        await this.startSession("carplay");
        return;
      case "end_session":
        await this.endSession();
        return;
      case "toggle_mute":
        if (!this.#snapshot.isActive) {
          await this.startSession("carplay");
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
          // CarPlay echoes the key it was given, which carries both ids.
          const thread = this.#snapshot.threads.find((item) => bridgeThreadKey(item) === event.id);
          await this.selectThread(thread ?? null);
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

  /** Applies a CarPlay connect or disconnect; the native listener calls this for every event. */
  async handleCarPlayConnection(connected: boolean): Promise<void> {
    this.#hasLiveCarPlayConnectionEvent = true;
    const wasConnected = this.#snapshot.carPlayConnected;
    this.#updateSnapshot({ carPlayConnected: connected });
    void this.#syncCarPlay();
    if (!connected) {
      if (this.#sessionOwner === "carplay") {
        await this.endSession();
      }
      return;
    }
    if (wasConnected) return;
    await this.hydrate();
    // Fails closed: an unreadable setting never counts as "auto-start on".
    if (
      this.#snapshot.carPlayConnected &&
      this.#snapshot.settings.autoStartOnCarPlay &&
      !this.#settingsReadFailed &&
      !this.#snapshot.isActive
    ) {
      await this.startSession("carplay");
    }
  }

  dispose(): void {
    const wasActive = this.#sessionOwner !== null;
    this.#generation += 1;
    this.#sessionOwner = null;
    this.#clearReconnectTimer();
    this.#clearStableTimer();
    this.#clearProposalTimer();
    for (const sub of this.#nativeSubscriptions) {
      sub.remove();
    }
    this.#nativeSubscriptions = [];
    void this.#teardownTransport();
    if (wasActive) {
      void this.#native.stopAudioSession().catch(() => undefined);
    }
  }

  /**
   * The one teardown for End, a terminal failure, a key change and a CarPlay disconnect. It
   * invalidates the generation before any await, so nothing from the old session acts afterwards.
   */
  async #closeSession(final: Partial<DriveControllerSnapshot>): Promise<void> {
    const generation = ++this.#generation;
    this.#sessionOwner = null;
    this.#retryCount = 0;
    this.#clearReconnectTimer();
    this.#clearStableTimer();
    this.#agentBridge.clearPendingConfirmation();
    this.#clearProposalTimer();
    this.#updateSnapshot({
      isActive: false,
      isMuted: false,
      activeTransport: null,
      inputLevel: 0,
      outputLevel: 0,
      reconnectAttempt: 0,
      pendingConfirmation: null,
      voiceInputUnavailableMessage: null,
      ...final,
    });

    await this.stopPreview();
    await this.#teardownTransport();
    // A new start may have begun while the transport closed; it owns the audio from here.
    if (generation === this.#generation) {
      await this.#native.clearPlaybackQueue().catch(() => undefined);
      await this.#native.stopFallbackSpeech().catch(() => undefined);
      await this.#native.stopAudioSession().catch(() => undefined);
    }
    await this.#syncCarPlay();
  }

  async #releaseAudioIfNoSessionWanted(): Promise<void> {
    if (this.#sessionOwner !== null) return;
    await this.#native.clearPlaybackQueue().catch(() => undefined);
    await this.#native.stopAudioSession().catch(() => undefined);
  }

  async #endSessionUsingKey(provider: ApiKeyProvider): Promise<void> {
    const transport = this.#transport;
    if (!this.#snapshot.isActive || !transport) return;
    if (!KEY_PROVIDERS_BY_TRANSPORT[transport.provider].includes(provider)) return;
    const message = m(msg("Voice session ended because the {provider} key changed."), {
      provider: KEY_PROVIDER_NAMES[provider],
    });
    await this.#closeSession({
      sessionState: "idle",
      errorMessage: null,
      activeCaption: message,
      activeCaptionRole: "system",
    });
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
        void this.handleCarPlayConnection(event.connected);
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

  /** Agent tools run only while the setting and the active persona both allow them. */
  #toolsEnabled(): boolean {
    return (
      this.#snapshot.settings.agentBridgeEnabled && this.#snapshot.activePersona.defaultToolsEnabled
    );
  }

  #dropProposalIfToolsOff(): void {
    if (this.#toolsEnabled()) return;
    this.#agentBridge.clearPendingConfirmation();
    this.#syncPendingConfirmation();
  }

  #restingSessionState(): DriveSessionState {
    return this.#snapshot.voiceInputUnavailableMessage !== null ? "idle" : "listening";
  }

  #buildSessionConfig(voice: VoiceProfile, persona: DrivingPersona): TransportSessionConfig {
    const activeThread =
      this.#snapshot.threads.find(
        (item) =>
          item.threadId === this.#snapshot.activeThreadId &&
          item.environmentId === this.#snapshot.activeThreadEnvironmentId,
      ) ?? null;
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

  async #connectTransportForVoice(
    generation: number,
    voice: VoiceProfile,
    persona: DrivingPersona,
  ): Promise<void> {
    const effectiveProvider = await this.#resolveEffectiveProvider(voice);
    let apiKey: string | null = null;
    if (effectiveProvider === "openai-realtime") {
      apiKey = await this.#settingsStore.getApiKey("openai");
    } else if (effectiveProvider === "gemini-live") {
      apiKey = await this.#settingsStore.getApiKey("gemini");
    } else if (effectiveProvider === "elevenlabs") {
      apiKey = await this.#settingsStore.getApiKey("elevenlabs");
    }
    if (generation !== this.#generation) return;

    const transport = this.#createTransport(voice, effectiveProvider, apiKey);
    this.#transport = transport;
    const config = this.#buildSessionConfig(voice, persona);
    const isCurrent = () => generation === this.#generation && this.#transport === transport;

    const callbacks: TransportCallbacks = {
      onConnected: () => {
        if (!isCurrent()) return;
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
        this.#armStableTimer(generation, transport);
        void this.#syncCarPlay();
      },
      onStateChange: (state) => {
        if (!isCurrent() || !this.#snapshot.isActive) return;
        const resolved: DriveSessionState =
          state === "listening"
            ? this.#snapshot.isMuted
              ? "muted"
              : this.#restingSessionState()
            : state;
        this.#updateSnapshot({ sessionState: resolved });
        void this.#syncCarPlay();
      },
      onAudioDelta: (pcm24kBase64, sampleRate) => {
        if (!isCurrent()) return;
        void this.#native.enqueuePcmAudio(pcm24kBase64, sampleRate).catch(() => undefined);
      },
      onBargeIn: () => {
        if (!isCurrent()) return;
        void this.#native.clearPlaybackQueue().catch(() => undefined);
        void this.#native.stopFallbackSpeech().catch(() => undefined);
      },
      onUserTranscript: (text, isFinal) => {
        if (!isCurrent()) return;
        this.#upsertTranscript("user", text, isFinal);
      },
      onAssistantTranscript: (text, isFinal) => {
        if (!isCurrent()) return;
        this.#upsertTranscript("assistant", text, isFinal, voice.id);
      },
      onToolCall: (name, args) => this.#executeToolCall(isCurrent, name, args),
      onError: (message, recoverable) => {
        if (!isCurrent()) return;
        if (recoverable) {
          this.#updateSnapshot({
            errorMessage: message,
            activeCaption: message,
            activeCaptionRole: "system",
          });
          void this.#syncCarPlay();
          return;
        }
        void this.#closeSession({
          sessionState: "error",
          errorMessage: message,
          activeCaption: message,
          activeCaptionRole: "system",
        });
      },
      onClose: (reason, unexpected) => {
        if (!isCurrent() || !unexpected) return;
        this.#scheduleReconnect(generation, reason);
      },
      onInputUnavailable: (message) => {
        if (!isCurrent()) return;
        void this.#native.setMuted(true).catch(() => undefined);
        this.#updateSnapshot({
          voiceInputUnavailableMessage: message,
          sessionState: "idle",
          errorMessage: message,
          activeCaption: message,
          activeCaptionRole: "system",
        });
        void this.#syncCarPlay();
      },
    };

    try {
      await this.#connectWithDeadline(transport, config, callbacks);
    } catch (error) {
      await transport.disconnect().catch(() => undefined);
      if (this.#transport === transport) this.#transport = null;
      throw error;
    }
    if (!isCurrent()) {
      await transport.disconnect().catch(() => undefined);
    }
  }

  async #connectWithDeadline(
    transport: RealtimeTransport,
    config: TransportSessionConfig,
    callbacks: TransportCallbacks,
  ): Promise<void> {
    const connecting = transport.connect(config, callbacks);
    // If the deadline wins, a later rejection from the abandoned attempt must not go unhandled.
    connecting.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(m(msg("The voice service did not become ready in time.")))),
        CONNECT_DEADLINE_MS,
      );
    });
    try {
      await Promise.race([connecting, deadline]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }

  /**
   * Runs a tool the voice model asked for. The current settings, the active persona and the session
   * generation are checked here, so turning the bridge off or ending the session stops tools that
   * the provider was already told about.
   */
  async #executeToolCall(
    isCurrent: () => boolean,
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<VoiceToolExecutionResult> {
    if (!isCurrent() || !this.#snapshot.isActive) {
      return refusal(m(msg("This voice session has ended, so that request was ignored.")));
    }
    const advertised = AGENT_BRIDGE_TOOLS.some((tool) => tool.name === name);
    // Approvals are not a Drive tool; the service answers that name with where to approve instead.
    if (name !== "respond_to_approval") {
      if (!this.#toolsEnabled()) {
        return refusal(m(msg("Agent tools are turned off, so I cannot do that.")));
      }
      if (!advertised) {
        return refusal(m(msg("That tool is not available in Drive.")));
      }
    }

    const result = await this.#agentBridge.executeTool(name, args);
    if (!isCurrent() || !this.#snapshot.isActive || !this.#toolsEnabled()) {
      this.#agentBridge.clearPendingConfirmation();
      this.#syncPendingConfirmation();
      return refusal(m(msg("This voice session has ended, so that request was ignored.")));
    }
    this.#syncPendingConfirmation();
    this.#updateSnapshot({ threads: this.#agentBridge.listThreads() });
    this.#appendTranscript("tool", result.spokenSummary, true, undefined, name);
    void this.#syncCarPlay();
    return result;
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
      getLocalTranscriber: this.#getLocalTranscriber,
      fetchImpl: this.#fetchImpl,
    });
  }

  #scheduleReconnect(generation: number, reason: string): void {
    if (generation !== this.#generation) return;
    this.#clearStableTimer();
    const nextAttempt = this.#retryCount + 1;
    if (nextAttempt > MAX_RECONNECT_ATTEMPTS) {
      void this.#closeSession({
        sessionState: "error",
        errorMessage: m(msg("Connection lost ({reason}). Tap Start to reconnect."), { reason }),
        activeCaption: m(msg("Connection lost. Tap Start to reconnect.")),
        activeCaptionRole: "system",
      });
      return;
    }

    this.#retryCount = nextAttempt;
    void this.#teardownTransport();
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
      if (generation !== this.#generation) return;
      void this.#connectTransportForVoice(
        generation,
        this.#snapshot.activeVoice,
        this.#snapshot.activePersona,
      ).catch(() => {
        this.#scheduleReconnect(generation, m(msg("Reconnect failed")));
      });
    }, delayMs);
  }

  #armStableTimer(generation: number, transport: RealtimeTransport): void {
    this.#clearStableTimer();
    this.#stableTimer = setTimeout(() => {
      this.#stableTimer = null;
      if (generation === this.#generation && this.#transport === transport) {
        this.#retryCount = 0;
      }
    }, STABLE_SESSION_MS);
  }

  #clearStableTimer(): void {
    if (this.#stableTimer !== null) {
      clearTimeout(this.#stableTimer);
      this.#stableTimer = null;
    }
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  /** Mirrors the service's proposal into the snapshot and removes it from the screen when it expires. */
  #syncPendingConfirmation(): void {
    this.#clearProposalTimer();
    const pending = this.#agentBridge.getPendingConfirmation();
    if (pending !== this.#snapshot.pendingConfirmation) {
      this.#updateSnapshot({ pendingConfirmation: pending });
    }
    if (pending) {
      const remaining = Math.max(pending.expiresAt - this.#now(), MIN_PROPOSAL_TIMER_MS);
      this.#proposalTimer = setTimeout(() => {
        this.#proposalTimer = null;
        this.#syncPendingConfirmation();
      }, remaining);
    }
  }

  #clearProposalTimer(): void {
    if (this.#proposalTimer !== null) {
      clearTimeout(this.#proposalTimer);
      this.#proposalTimer = null;
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
        id: bridgeThreadKey(thread),
        title: thread.title,
        status: thread.status,
        badge: thread.lastActivityLabel,
        isSelected:
          thread.threadId === snap.activeThreadId &&
          thread.environmentId === snap.activeThreadEnvironmentId,
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
    (ref: BridgeThreadRef | null) => carplayDriveController.selectThread(ref),
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
  const confirmPendingAction = useCallback(
    (proposalId: string) => carplayDriveController.confirmPendingAction(proposalId),
    [],
  );
  const dismissPendingAction = useCallback(
    (proposalId: string) => carplayDriveController.dismissPendingAction(proposalId),
    [],
  );
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
