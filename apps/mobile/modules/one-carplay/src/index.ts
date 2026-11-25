import { requireOptionalNativeModule } from "expo";

export type VoiceSessionPhase =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "muted"
  | "error";

export interface AudioSessionOptions {
  readonly sampleRate?: number;
  readonly chunkDurationMs?: number;
  readonly enableEchoCancellation?: boolean;
  readonly muted?: boolean;
}

export interface AudioSessionStartResult {
  readonly started: boolean;
  readonly sampleRate: number;
  readonly channels: number;
  readonly echoCancellationActive: boolean;
  readonly routeName: string;
}

export interface FallbackSpeechOptions {
  readonly voiceIdentifier?: string;
  readonly language?: string;
  readonly rate?: number;
  readonly pitch?: number;
}

export interface CarPlayVoiceItem {
  readonly id: string;
  readonly displayName: string;
  readonly subtitle: string;
  readonly group: string;
  readonly vibe?: string;
  readonly isFavorite?: boolean;
  readonly isSelected?: boolean;
}

export interface CarPlayModeItem {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly isSelected?: boolean;
}

export type CarPlayThreadStatus = "needs_approval" | "running" | "ready" | "idle" | "error";

export interface CarPlayThreadItem {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly status: CarPlayThreadStatus;
  readonly statusLabel: string;
  readonly projectName?: string;
  readonly isSelected?: boolean;
}

export interface CarPlayDashboardState {
  readonly sessionActive: boolean;
  readonly phase: VoiceSessionPhase;
  readonly muted: boolean;
  readonly voiceId: string;
  readonly voiceName: string;
  readonly personaId: string;
  readonly personaName: string;
  readonly topicTitle: string;
  readonly liveCaption: string;
  readonly activeThreadId?: string | null;
  readonly activeThreadTitle?: string | null;
  readonly voices: ReadonlyArray<CarPlayVoiceItem>;
  readonly modes: ReadonlyArray<CarPlayModeItem>;
  readonly threads: ReadonlyArray<CarPlayThreadItem>;
}

export interface CarPlayStatus {
  readonly available: boolean;
  readonly connected: boolean;
  readonly audioSessionActive: boolean;
  readonly muted: boolean;
  readonly platform: "ios" | "android" | "unsupported";
  readonly carPlayEntitlementExpected: boolean;
  readonly audioRouteName: string;
}

export interface AudioChunkEvent {
  readonly pcm16Base64: string;
  readonly sampleRate: number;
  readonly channels: number;
  readonly frameCount: number;
  readonly rms: number;
  readonly timestampMs: number;
}

export interface AudioLevelEvent {
  readonly source: "input" | "output";
  readonly level: number;
  readonly peak: number;
  readonly timestampMs: number;
}

export type CarPlayActionType =
  | "start_session"
  | "end_session"
  | "toggle_mute"
  | "interrupt"
  | "repeat_or_new_topic"
  | "cycle_voice"
  | "select_voice"
  | "select_mode"
  | "select_thread";

export interface CarPlayActionEvent {
  readonly action: CarPlayActionType;
  readonly voiceId?: string;
  readonly modeId?: string;
  readonly threadId?: string;
  readonly source: "carplay_ui" | "steering_wheel" | "now_playing";
  readonly timestampMs: number;
}

export interface CarPlayConnectionEvent {
  readonly connected: boolean;
  readonly interfaceStyle: "light" | "dark" | "unspecified";
  readonly timestampMs: number;
}

export type AudioInterruptionType = "began" | "ended" | "route_changed";

export interface AudioInterruptionEvent {
  readonly type: AudioInterruptionType;
  readonly shouldResume: boolean;
  readonly reason: string;
  readonly routeName?: string;
  readonly timestampMs: number;
}

export interface OneCarPlaySubscription {
  remove(): void;
}

interface OneCarPlayNativeEvents {
  readonly onAudioChunk: AudioChunkEvent;
  readonly onAudioLevel: AudioLevelEvent;
  readonly onCarPlayAction: CarPlayActionEvent;
  readonly onCarPlayConnection: CarPlayConnectionEvent;
  readonly onAudioInterruption: AudioInterruptionEvent;
}

interface OneCarPlayNativeModule {
  startAudioSession(options: {
    sampleRate: number;
    chunkDurationMs: number;
    enableEchoCancellation: boolean;
    muted: boolean;
  }): Promise<AudioSessionStartResult>;
  stopAudioSession(): Promise<void>;
  enqueuePcmAudio(base64Pcm16: string, sampleRate: number): Promise<void>;
  clearPlaybackQueue(): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  speakFallbackText(
    text: string,
    options: {
      voiceIdentifier?: string;
      language: string;
      rate: number;
      pitch: number;
    },
  ): Promise<void>;
  stopFallbackSpeech(): Promise<void>;
  updateCarPlayState(state: CarPlayDashboardState): Promise<void>;
  getCarPlayStatus(): Promise<CarPlayStatus>;
  addListener<K extends keyof OneCarPlayNativeEvents>(
    eventName: K,
    listener: (event: OneCarPlayNativeEvents[K]) => void,
  ): OneCarPlaySubscription;
}

const DEFAULT_SAMPLE_RATE = 24_000;
const DEFAULT_CHUNK_DURATION_MS = 100;
const NOOP_SUBSCRIPTION: OneCarPlaySubscription = { remove: () => undefined };

let fallbackSessionActive = false;
let fallbackMuted = false;

function getNativeModule(): OneCarPlayNativeModule | null {
  try {
    if (typeof requireOptionalNativeModule !== "function") {
      return null;
    }
    return requireOptionalNativeModule<OneCarPlayNativeModule>("OneCarPlay");
  } catch {
    return null;
  }
}

export function isNativeCarPlayModuleAvailable(): boolean {
  return getNativeModule() !== null;
}

export async function startAudioSession(
  options: AudioSessionOptions = {},
): Promise<AudioSessionStartResult> {
  const normalized = {
    sampleRate: options.sampleRate ?? DEFAULT_SAMPLE_RATE,
    chunkDurationMs: options.chunkDurationMs ?? DEFAULT_CHUNK_DURATION_MS,
    enableEchoCancellation: options.enableEchoCancellation ?? true,
    muted: options.muted ?? false,
  };
  const native = getNativeModule();
  if (!native) {
    fallbackSessionActive = true;
    fallbackMuted = normalized.muted;
    return {
      started: false,
      sampleRate: normalized.sampleRate,
      channels: 1,
      echoCancellationActive: false,
      routeName: "unavailable",
    };
  }
  return native.startAudioSession(normalized);
}

export async function stopAudioSession(): Promise<void> {
  const native = getNativeModule();
  if (!native) {
    fallbackSessionActive = false;
    fallbackMuted = false;
    return;
  }
  await native.stopAudioSession();
}

export async function enqueuePcmAudio(
  base64Pcm16: string,
  sampleRate: number = DEFAULT_SAMPLE_RATE,
): Promise<void> {
  if (!base64Pcm16) return;
  const native = getNativeModule();
  if (!native) return;
  await native.enqueuePcmAudio(base64Pcm16, sampleRate);
}

export async function clearPlaybackQueue(): Promise<void> {
  const native = getNativeModule();
  if (!native) return;
  await native.clearPlaybackQueue();
}

export async function setMuted(muted: boolean): Promise<void> {
  const native = getNativeModule();
  if (!native) {
    fallbackMuted = muted;
    return;
  }
  await native.setMuted(muted);
}

export async function speakFallbackText(
  text: string,
  options: FallbackSpeechOptions = {},
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const native = getNativeModule();
  if (!native) return;
  await native.speakFallbackText(trimmed, {
    ...(options.voiceIdentifier ? { voiceIdentifier: options.voiceIdentifier } : {}),
    language: options.language ?? "en-US",
    rate: options.rate ?? 1.0,
    pitch: options.pitch ?? 1.0,
  });
}

export async function stopFallbackSpeech(): Promise<void> {
  const native = getNativeModule();
  if (!native) return;
  await native.stopFallbackSpeech();
}

export async function updateCarPlayState(state: CarPlayDashboardState): Promise<void> {
  const native = getNativeModule();
  if (!native) return;
  await native.updateCarPlayState(state);
}

export async function getCarPlayStatus(): Promise<CarPlayStatus> {
  const native = getNativeModule();
  if (!native) {
    return {
      available: false,
      connected: false,
      audioSessionActive: fallbackSessionActive,
      muted: fallbackMuted,
      platform: "unsupported",
      carPlayEntitlementExpected: false,
      audioRouteName: "unavailable",
    };
  }
  return native.getCarPlayStatus();
}

export function addAudioChunkListener(
  listener: (event: AudioChunkEvent) => void,
): OneCarPlaySubscription {
  const native = getNativeModule();
  if (!native) return NOOP_SUBSCRIPTION;
  return native.addListener("onAudioChunk", listener);
}

export function addAudioLevelListener(
  listener: (event: AudioLevelEvent) => void,
): OneCarPlaySubscription {
  const native = getNativeModule();
  if (!native) return NOOP_SUBSCRIPTION;
  return native.addListener("onAudioLevel", listener);
}

export function addCarPlayActionListener(
  listener: (event: CarPlayActionEvent) => void,
): OneCarPlaySubscription {
  const native = getNativeModule();
  if (!native) return NOOP_SUBSCRIPTION;
  return native.addListener("onCarPlayAction", listener);
}

export function addCarPlayConnectionListener(
  listener: (event: CarPlayConnectionEvent) => void,
): OneCarPlaySubscription {
  const native = getNativeModule();
  if (!native) return NOOP_SUBSCRIPTION;
  return native.addListener("onCarPlayConnection", listener);
}

export function addInterruptionListener(
  listener: (event: AudioInterruptionEvent) => void,
): OneCarPlaySubscription {
  const native = getNativeModule();
  if (!native) return NOOP_SUBSCRIPTION;
  return native.addListener("onAudioInterruption", listener);
}
