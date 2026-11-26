import * as OneCarPlayNative from "@t3tools/mobile-carplay-native";
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from "expo-audio";
import { msg } from "gt-react-native";

import { m } from "../../../i18n/messages";
import { vibeLabelMessage } from "../ui/driveUiTypes";
import { buildCarPlayLabels } from "./carplayLabels";
import type {
  CarPlayActionEvent,
  CarPlayNativeAdapter,
  CarPlaySyncPayload,
  DriveSessionState,
} from "./types";

function mapSessionStateToNativePhase(
  state: DriveSessionState,
): OneCarPlayNative.VoiceSessionPhase {
  if (state === "interrupted") return "listening";
  return state;
}

function mapNativeAction(event: OneCarPlayNative.CarPlayActionEvent): CarPlayActionEvent | null {
  switch (event.action) {
    case "start_session":
      return { action: "start_session" };
    case "end_session":
      return { action: "end_session" };
    case "toggle_mute":
      return { action: "toggle_mute" };
    case "interrupt":
      return { action: "interrupt" };
    case "repeat_or_new_topic":
      return { action: "repeat_last" };
    case "cycle_voice":
      return { action: "next_voice" };
    case "select_voice":
      return { action: "select_voice", id: event.voiceId };
    case "select_mode":
      return { action: "select_persona", id: event.modeId };
    case "select_thread":
      return { action: "select_thread", id: event.threadId };
    default:
      return null;
  }
}

export function toNativeDashboardState(
  payload: CarPlaySyncPayload,
): OneCarPlayNative.CarPlayDashboardState {
  const activeThread = payload.threads.find((thread) => thread.isSelected);
  return {
    sessionActive: payload.sessionState !== "idle" && payload.sessionState !== "error",
    phase: mapSessionStateToNativePhase(payload.sessionState),
    muted: payload.isMuted,
    voiceId: payload.activeVoiceId,
    voiceName: payload.activeVoiceName,
    personaId: payload.activePersonaId,
    personaName: payload.activePersonaName,
    topicTitle: payload.activeTopic,
    // The voice-based CarPlay category speaks answers; the caption stays on the phone.
    labels: buildCarPlayLabels(),
    activeThreadId: activeThread?.id ?? null,
    activeThreadTitle: activeThread?.title ?? null,
    voices: payload.voices.map((voice) => ({
      id: voice.id,
      displayName: voice.name,
      subtitle: voice.detail,
      group: voice.isFavorite ? m(msg("Favorites")) : m(vibeLabelMessage(voice.vibe)),
      vibe: voice.vibe,
      isFavorite: voice.isFavorite,
      isSelected: voice.isSelected,
    })),
    modes: payload.personas.map((persona) => ({
      id: persona.id,
      title: persona.name,
      subtitle: persona.detail,
      isSelected: persona.isSelected,
    })),
    threads: payload.threads.map((thread) => ({
      id: thread.id,
      title: thread.title,
      subtitle: thread.badge,
      status: thread.status,
      statusLabel: thread.badge,
      isSelected: thread.isSelected,
    })),
  };
}

export function createNativeCarPlayAdapter(): CarPlayNativeAdapter {
  let latestInputLevel = 0;
  let latestOutputLevel = 0;

  return {
    async startAudioSession(options) {
      if (OneCarPlayNative.isNativeCarPlayModuleAvailable()) {
        const current = await getRecordingPermissionsAsync();
        if (!current.granted) {
          const requested = await requestRecordingPermissionsAsync();
          if (!requested.granted) {
            throw new Error(
              m(
                msg(
                  "Microphone permission is required for hands-free voice chat. Enable microphone access in Settings and try again.",
                ),
              ),
            );
          }
        }
      }
      await OneCarPlayNative.startAudioSession({
        sampleRate: options?.sampleRate ?? 24_000,
        chunkDurationMs: 100,
        enableEchoCancellation: true,
        muted: false,
      });
    },

    async stopAudioSession() {
      latestInputLevel = 0;
      latestOutputLevel = 0;
      await OneCarPlayNative.stopAudioSession();
    },

    async enqueuePcmAudio(base64Pcm, sampleRate = 24_000) {
      await OneCarPlayNative.enqueuePcmAudio(base64Pcm, sampleRate);
    },

    async clearPlaybackQueue() {
      await OneCarPlayNative.clearPlaybackQueue();
    },

    async setMuted(muted) {
      await OneCarPlayNative.setMuted(muted);
    },

    async speakFallbackText(text, options) {
      await OneCarPlayNative.speakFallbackText(text, {
        ...(options?.voiceId && !options.voiceId.includes(":")
          ? { voiceIdentifier: options.voiceId }
          : {}),
        language: "en-US",
        rate: options?.rate ?? 1.0,
        pitch: 1.0,
      });
    },

    async stopFallbackSpeech() {
      await OneCarPlayNative.stopFallbackSpeech();
    },

    async updateCarPlayState(payload) {
      await OneCarPlayNative.updateCarPlayState(toNativeDashboardState(payload));
    },

    async getCarPlayStatus() {
      const status = await OneCarPlayNative.getCarPlayStatus();
      return { connected: status.connected };
    },

    addAudioChunkListener(listener) {
      return OneCarPlayNative.addAudioChunkListener((event) => {
        listener({
          base64Pcm: event.pcm16Base64,
          sampleRate: event.sampleRate,
        });
      });
    },

    addAudioLevelListener(listener) {
      return OneCarPlayNative.addAudioLevelListener((event) => {
        if (event.source === "input") {
          latestInputLevel = event.level;
        } else {
          latestOutputLevel = event.level;
        }
        listener({
          inputLevel: latestInputLevel,
          outputLevel: latestOutputLevel,
        });
      });
    },

    addCarPlayActionListener(listener) {
      return OneCarPlayNative.addCarPlayActionListener((event) => {
        const mapped = mapNativeAction(event);
        if (mapped) {
          listener(mapped);
        }
      });
    },

    addCarPlayConnectionListener(listener) {
      return OneCarPlayNative.addCarPlayConnectionListener((event) => {
        listener({ connected: event.connected });
      });
    },

    addInterruptionListener(listener) {
      return OneCarPlayNative.addInterruptionListener((event) => {
        if (event.type === "began" || event.type === "ended") {
          listener({
            type: event.type,
            shouldResume: event.shouldResume,
          });
        }
      });
    },
  };
}
