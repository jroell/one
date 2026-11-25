import { msg } from "gt-react-native";

import type {
  ApiKeyProvider,
  ApiKeyStatusMap,
  BridgeThreadRef,
  BridgeThreadSummary,
  CarPlaySettings,
  DriveControllerSnapshot,
  DriveSessionState,
  DrivingPersona,
  PendingConfirmation,
  PersonaId,
  TranscriptEntry,
  VoiceProfile,
  VoiceProvider,
  VoiceVibe,
} from "../engine/types";

export type {
  ApiKeyProvider as ApiKeyProviderId,
  ApiKeyStatusMap as ApiKeysConfiguredView,
  BridgeThreadRef as BridgeThreadRefView,
  BridgeThreadSummary as BridgeThreadView,
  CarPlaySettings as CarPlaySettingsView,
  DriveControllerSnapshot as DriveSnapshotView,
  DriveSessionState,
  DrivingPersona as DrivingPersonaView,
  PendingConfirmation as PendingConfirmationView,
  PersonaId,
  TranscriptEntry as TranscriptEntryView,
  VoiceProfile as VoiceProfileView,
  VoiceProvider as VoiceProviderId,
  VoiceVibe as VoiceVibeId,
};

export const PROVIDER_FILTER_OPTIONS: ReadonlyArray<{
  readonly id: "all" | VoiceProvider;
  readonly label: string;
}> = [
  { id: "all", label: msg("All") },
  { id: "openai-realtime", label: msg("OpenAI Realtime") },
  { id: "gemini-live", label: msg("Gemini Live") },
  { id: "elevenlabs", label: msg("ElevenLabs") },
  { id: "on-device", label: msg("On-device") },
];

export const VIBE_FILTER_OPTIONS: ReadonlyArray<{
  readonly id: "all" | VoiceVibe;
  readonly label: string;
}> = [
  { id: "all", label: msg("All vibes") },
  { id: "warm", label: msg("Warm") },
  { id: "crisp", label: msg("Crisp") },
  { id: "deep", label: msg("Deep") },
  { id: "energetic", label: msg("Energetic") },
  { id: "calm", label: msg("Calm") },
  { id: "narrative", label: msg("Narrative") },
];

const PROVIDER_LABELS: Readonly<Record<VoiceProvider, string>> = {
  "openai-realtime": msg("OpenAI Realtime"),
  "gemini-live": msg("Gemini Live"),
  elevenlabs: msg("ElevenLabs"),
  "on-device": msg("On-device"),
};

const VIBE_LABELS: Readonly<Record<VoiceVibe, string>> = {
  warm: msg("Warm"),
  crisp: msg("Crisp"),
  deep: msg("Deep"),
  energetic: msg("Energetic"),
  calm: msg("Calm"),
  narrative: msg("Narrative"),
};

export function providerLabelMessage(provider: VoiceProvider): string {
  return PROVIDER_LABELS[provider];
}

export function vibeLabelMessage(vibe: VoiceVibe): string {
  return VIBE_LABELS[vibe];
}

export function isProviderKeyReady(provider: VoiceProvider, keys: ApiKeyStatusMap): boolean {
  switch (provider) {
    case "openai-realtime":
      return keys.openai;
    case "gemini-live":
      return keys.gemini;
    case "elevenlabs":
      return keys.elevenlabs;
    case "on-device":
      return true;
  }
}
