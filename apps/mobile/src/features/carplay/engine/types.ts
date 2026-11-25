export const DEFAULT_OPENAI_REALTIME_MODEL = "gpt-realtime";
export const DEFAULT_GEMINI_LIVE_MODEL = "models/gemini-2.5-flash-native-audio-preview-09-2025";

export type VoiceProvider = "openai-realtime" | "gemini-live" | "elevenlabs" | "on-device";

export type VoiceVibe = "warm" | "crisp" | "deep" | "energetic" | "calm" | "narrative";

export interface VoiceProfile {
  readonly id: string;
  readonly provider: VoiceProvider;
  readonly providerVoiceId: string;
  readonly displayName: string;
  readonly tagline: string;
  readonly vibe: VoiceVibe;
  readonly accentColor: string;
  readonly sampleLine: string;
  readonly defaultSpeed: number;
  readonly supportsRealtime: boolean;
}

export type PersonaId =
  | "copilot"
  | "agent-bridge"
  | "architect"
  | "brainstorm"
  | "briefing"
  | "lore";

export interface DrivingPersona {
  readonly id: PersonaId;
  readonly name: string;
  readonly shortName: string;
  readonly tagline: string;
  readonly iconName: string;
  readonly accentColor: string;
  readonly systemPrompt: string;
  readonly defaultToolsEnabled: boolean;
  readonly maxSpokenSentences: number;
}

export type DriveSessionState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "muted"
  | "interrupted"
  | "error";

export type BargeInSensitivity = "low" | "balanced" | "high";

export type VadMode = "semantic_vad" | "server_vad";

export type ApiKeyProvider = "openai" | "gemini" | "elevenlabs";

export type ApiKeyStatusMap = Readonly<Record<ApiKeyProvider, boolean>>;

export interface TranscriptEntry {
  readonly id: string;
  readonly role: "user" | "assistant" | "system" | "tool";
  readonly text: string;
  readonly timestamp: number;
  readonly isFinal: boolean;
  readonly voiceId?: string;
  readonly toolName?: string;
}

export interface CarPlaySettings {
  readonly selectedVoiceId: string;
  readonly selectedPersonaId: PersonaId;
  readonly favoriteVoiceIds: ReadonlyArray<string>;
  readonly bargeInEnabled: boolean;
  readonly bargeInSensitivity: BargeInSensitivity;
  readonly vadMode: VadMode;
  readonly autoStartOnCarPlay: boolean;
  readonly agentBridgeEnabled: boolean;
  readonly spokenSpeed: number;
  readonly openaiModel: string;
  readonly geminiModel: string;
  readonly elevenLabsCustomVoiceId: string;
}

export type BridgeThreadStatus = "needs_approval" | "running" | "ready" | "error";

export interface BridgeThreadSummary {
  readonly environmentId: string;
  readonly threadId: string;
  readonly title: string;
  readonly status: BridgeThreadStatus;
  readonly pendingApprovalCount: number;
  readonly lastActivityLabel: string;
  readonly branch?: string | null;
}

export interface PendingConfirmation {
  readonly id: string;
  readonly toolName: "send_message_to_thread" | "respond_to_approval";
  readonly summary: string;
  readonly expiresAt: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface DriveControllerSnapshot {
  readonly sessionState: DriveSessionState;
  readonly isActive: boolean;
  readonly isMuted: boolean;
  readonly carPlayConnected: boolean;
  readonly activeTransport: VoiceProvider | null;
  readonly activeVoice: VoiceProfile;
  readonly activePersona: DrivingPersona;
  readonly inputLevel: number;
  readonly outputLevel: number;
  readonly activeCaption: string;
  readonly activeCaptionRole: "user" | "assistant" | "system";
  readonly transcript: ReadonlyArray<TranscriptEntry>;
  readonly previewingVoiceId: string | null;
  readonly errorMessage: string | null;
  readonly reconnectAttempt: number;
  readonly activeThreadId: string | null;
  readonly activeThreadTitle: string | null;
  readonly threads: ReadonlyArray<BridgeThreadSummary>;
  readonly pendingConfirmation: PendingConfirmation | null;
  readonly settings: CarPlaySettings;
  readonly apiKeysConfigured: ApiKeyStatusMap;
}

export interface ToolJsonSchema {
  readonly type: "object";
  readonly properties: Readonly<
    Record<
      string,
      {
        readonly type: string;
        readonly description: string;
        readonly enum?: ReadonlyArray<string>;
      }
    >
  >;
  readonly required?: ReadonlyArray<string>;
}

export interface VoiceToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolJsonSchema;
}

export interface VoiceToolExecutionResult {
  readonly ok: boolean;
  readonly status: "completed" | "needs_confirmation" | "disconnected" | "error";
  readonly spokenSummary: string;
  readonly data?: unknown;
  readonly confirmation?: PendingConfirmation;
}

export type ToolExecutor = (
  name: string,
  args: Readonly<Record<string, unknown>>,
) => Promise<VoiceToolExecutionResult>;

export interface TransportCallbacks {
  readonly onConnected: () => void;
  readonly onStateChange: (state: DriveSessionState) => void;
  readonly onAudioDelta: (pcm24kBase64: string, sampleRate: number) => void;
  readonly onBargeIn: () => void;
  readonly onUserTranscript: (text: string, isFinal: boolean) => void;
  readonly onAssistantTranscript: (text: string, isFinal: boolean) => void;
  readonly onToolCall?: (
    name: string,
    args: Readonly<Record<string, unknown>>,
  ) => Promise<VoiceToolExecutionResult>;
  readonly onError: (message: string, recoverable: boolean) => void;
  readonly onClose: (reason: string, unexpected: boolean) => void;
}

export interface TransportSessionConfig {
  readonly voice: VoiceProfile;
  readonly persona: DrivingPersona;
  readonly instructions: string;
  readonly vadMode: VadMode;
  readonly bargeInEnabled: boolean;
  readonly bargeInSensitivity: BargeInSensitivity;
  readonly spokenSpeed: number;
  readonly tools: ReadonlyArray<VoiceToolDefinition>;
}

export interface RealtimeTransport {
  readonly provider: VoiceProvider;
  connect(config: TransportSessionConfig, callbacks: TransportCallbacks): Promise<void>;
  sendAudioChunk(pcm24kBase64: string, sampleRate: number): void;
  sendTextTurn(text: string): void;
  interrupt(): void;
  updateSession(config: Partial<TransportSessionConfig>): Promise<void>;
  disconnect(): Promise<void>;
}

export type CarPlayActionType =
  | "toggle_mute"
  | "interrupt"
  | "start_session"
  | "end_session"
  | "select_voice"
  | "select_persona"
  | "select_thread"
  | "repeat_last"
  | "next_voice";

export interface CarPlayActionEvent {
  readonly action: CarPlayActionType;
  readonly id?: string;
}

export interface CarPlayVoiceSyncItem {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
  readonly vibe: VoiceVibe;
  readonly isFavorite: boolean;
  readonly isSelected: boolean;
}

export interface CarPlayPersonaSyncItem {
  readonly id: PersonaId;
  readonly name: string;
  readonly detail: string;
  readonly isSelected: boolean;
}

export interface CarPlayThreadSyncItem {
  readonly id: string;
  readonly title: string;
  readonly status: BridgeThreadStatus;
  readonly badge: string;
  readonly isSelected: boolean;
}

export interface CarPlaySyncPayload {
  readonly sessionState: DriveSessionState;
  readonly isMuted: boolean;
  readonly activeVoiceId: string;
  readonly activeVoiceName: string;
  readonly activePersonaId: PersonaId;
  readonly activePersonaName: string;
  readonly activeTopic: string;
  readonly activeCaption: string;
  readonly voices: ReadonlyArray<CarPlayVoiceSyncItem>;
  readonly personas: ReadonlyArray<CarPlayPersonaSyncItem>;
  readonly threads: ReadonlyArray<CarPlayThreadSyncItem>;
}

export interface NativeSubscription {
  remove(): void;
}

export interface CarPlayNativeAdapter {
  startAudioSession(options?: { readonly sampleRate?: number }): Promise<void>;
  stopAudioSession(): Promise<void>;
  enqueuePcmAudio(base64Pcm: string, sampleRate?: number): Promise<void>;
  clearPlaybackQueue(): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  speakFallbackText(
    text: string,
    options?: { readonly rate?: number; readonly voiceId?: string },
  ): Promise<void>;
  stopFallbackSpeech(): Promise<void>;
  updateCarPlayState(payload: CarPlaySyncPayload): Promise<void>;
  getCarPlayStatus(): Promise<{ readonly connected: boolean }>;
  addAudioChunkListener(
    listener: (event: { readonly base64Pcm: string; readonly sampleRate: number }) => void,
  ): NativeSubscription;
  addAudioLevelListener(
    listener: (event: { readonly inputLevel: number; readonly outputLevel: number }) => void,
  ): NativeSubscription;
  addCarPlayActionListener(listener: (event: CarPlayActionEvent) => void): NativeSubscription;
  addCarPlayConnectionListener(
    listener: (event: { readonly connected: boolean }) => void,
  ): NativeSubscription;
  addInterruptionListener(
    listener: (event: {
      readonly type: "began" | "ended";
      readonly shouldResume?: boolean;
    }) => void,
  ): NativeSubscription;
}

export interface WebSocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { readonly code?: number; readonly reason?: string }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketFactory = (
  url: string,
  options?: {
    readonly protocols?: ReadonlyArray<string>;
    readonly headers?: Readonly<Record<string, string>>;
  },
) => WebSocketLike;
