import * as SecureStore from "expo-secure-store";

import { DEFAULT_PERSONA_ID, DRIVING_PERSONAS } from "./personas";
import {
  DEFAULT_GEMINI_LIVE_MODEL,
  DEFAULT_OPENAI_REALTIME_MODEL,
  type ApiKeyProvider,
  type ApiKeyStatusMap,
  type BargeInSensitivity,
  type CarPlaySettings,
  type PersonaId,
  type VadMode,
} from "./types";
import { DEFAULT_VOICE_ID, VOICE_CATALOG } from "./voiceCatalog";

const SETTINGS_STORAGE_KEY = "one.carplay.settings.v1";
const API_KEY_STORAGE_KEYS: Readonly<Record<ApiKeyProvider, string>> = {
  openai: "one.carplay.api-key.openai.v1",
  gemini: "one.carplay.api-key.gemini.v1",
  elevenlabs: "one.carplay.api-key.elevenlabs.v1",
};

export const DEFAULT_CARPLAY_SETTINGS: CarPlaySettings = {
  selectedVoiceId: DEFAULT_VOICE_ID,
  selectedPersonaId: DEFAULT_PERSONA_ID,
  favoriteVoiceIds: ["openai:marin", "openai:cedar", "gemini:Puck", "on-device:pilot"],
  bargeInEnabled: true,
  bargeInSensitivity: "balanced",
  vadMode: "semantic_vad",
  autoStartOnCarPlay: true,
  agentBridgeEnabled: true,
  spokenSpeed: 1.0,
  openaiModel: DEFAULT_OPENAI_REALTIME_MODEL,
  geminiModel: DEFAULT_GEMINI_LIVE_MODEL,
  elevenLabsCustomVoiceId: "",
};

export interface SecureKeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

const VALID_VOICE_IDS = new Set(VOICE_CATALOG.map((voice) => voice.id));
const VALID_PERSONA_IDS = new Set<PersonaId>(DRIVING_PERSONAS.map((persona) => persona.id));
const VALID_SENSITIVITIES = new Set<BargeInSensitivity>(["low", "balanced", "high"]);
const VALID_VAD_MODES = new Set<VadMode>(["semantic_vad", "server_vad"]);

function createExpoSecureStorage(): SecureKeyValueStorage {
  const options = {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
  return {
    async getItem(key) {
      try {
        return await SecureStore.getItemAsync(key, options);
      } catch {
        return null;
      }
    },
    async setItem(key, value) {
      await SecureStore.setItemAsync(key, value, options);
    },
    async deleteItem(key) {
      try {
        await SecureStore.deleteItemAsync(key, options);
      } catch {
        // Deleting a missing key should remain idempotent.
      }
    },
  };
}

export function normalizeCarPlaySettings(raw: unknown): CarPlaySettings {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_CARPLAY_SETTINGS;
  }
  const obj = raw as Record<string, unknown>;

  const selectedVoiceId =
    typeof obj.selectedVoiceId === "string" && VALID_VOICE_IDS.has(obj.selectedVoiceId)
      ? obj.selectedVoiceId
      : DEFAULT_CARPLAY_SETTINGS.selectedVoiceId;

  const selectedPersonaId =
    typeof obj.selectedPersonaId === "string" &&
    VALID_PERSONA_IDS.has(obj.selectedPersonaId as PersonaId)
      ? (obj.selectedPersonaId as PersonaId)
      : DEFAULT_CARPLAY_SETTINGS.selectedPersonaId;

  const favoriteVoiceIds = Array.isArray(obj.favoriteVoiceIds)
    ? Array.from(
        new Set(
          obj.favoriteVoiceIds.filter(
            (id): id is string => typeof id === "string" && VALID_VOICE_IDS.has(id),
          ),
        ),
      )
    : DEFAULT_CARPLAY_SETTINGS.favoriteVoiceIds;

  const bargeInSensitivity =
    typeof obj.bargeInSensitivity === "string" &&
    VALID_SENSITIVITIES.has(obj.bargeInSensitivity as BargeInSensitivity)
      ? (obj.bargeInSensitivity as BargeInSensitivity)
      : DEFAULT_CARPLAY_SETTINGS.bargeInSensitivity;

  const vadMode =
    typeof obj.vadMode === "string" && VALID_VAD_MODES.has(obj.vadMode as VadMode)
      ? (obj.vadMode as VadMode)
      : DEFAULT_CARPLAY_SETTINGS.vadMode;

  const spokenSpeedRaw =
    typeof obj.spokenSpeed === "number" && Number.isFinite(obj.spokenSpeed)
      ? obj.spokenSpeed
      : DEFAULT_CARPLAY_SETTINGS.spokenSpeed;
  const spokenSpeed = Math.round(Math.max(0.75, Math.min(1.5, spokenSpeedRaw)) * 100) / 100;

  return {
    selectedVoiceId,
    selectedPersonaId,
    favoriteVoiceIds,
    bargeInEnabled:
      typeof obj.bargeInEnabled === "boolean"
        ? obj.bargeInEnabled
        : DEFAULT_CARPLAY_SETTINGS.bargeInEnabled,
    bargeInSensitivity,
    vadMode,
    autoStartOnCarPlay:
      typeof obj.autoStartOnCarPlay === "boolean"
        ? obj.autoStartOnCarPlay
        : DEFAULT_CARPLAY_SETTINGS.autoStartOnCarPlay,
    agentBridgeEnabled:
      typeof obj.agentBridgeEnabled === "boolean"
        ? obj.agentBridgeEnabled
        : DEFAULT_CARPLAY_SETTINGS.agentBridgeEnabled,
    spokenSpeed,
    openaiModel:
      typeof obj.openaiModel === "string" && obj.openaiModel.trim().length > 0
        ? obj.openaiModel.trim()
        : DEFAULT_CARPLAY_SETTINGS.openaiModel,
    geminiModel:
      typeof obj.geminiModel === "string" && obj.geminiModel.trim().length > 0
        ? obj.geminiModel.trim()
        : DEFAULT_CARPLAY_SETTINGS.geminiModel,
    elevenLabsCustomVoiceId:
      typeof obj.elevenLabsCustomVoiceId === "string" ? obj.elevenLabsCustomVoiceId.trim() : "",
  };
}

export class CarPlaySettingsStore {
  readonly #storage: SecureKeyValueStorage;

  constructor(storage: SecureKeyValueStorage = createExpoSecureStorage()) {
    this.#storage = storage;
  }

  async loadSettings(): Promise<CarPlaySettings> {
    const raw = await this.#storage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_CARPLAY_SETTINGS;
    try {
      return normalizeCarPlaySettings(JSON.parse(raw));
    } catch {
      return DEFAULT_CARPLAY_SETTINGS;
    }
  }

  async saveSettings(settings: CarPlaySettings): Promise<CarPlaySettings> {
    const normalized = normalizeCarPlaySettings(settings);
    await this.#storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  async getApiKey(provider: ApiKeyProvider): Promise<string | null> {
    const value = await this.#storage.getItem(API_KEY_STORAGE_KEYS[provider]);
    const trimmed = value?.trim() ?? "";
    return trimmed.length > 0 ? trimmed : null;
  }

  async setApiKey(provider: ApiKeyProvider, rawKey: string): Promise<boolean> {
    const trimmed = rawKey.trim();
    if (trimmed.length === 0) {
      await this.#storage.deleteItem(API_KEY_STORAGE_KEYS[provider]);
      return false;
    }
    await this.#storage.setItem(API_KEY_STORAGE_KEYS[provider], trimmed);
    return true;
  }

  async clearApiKey(provider: ApiKeyProvider): Promise<void> {
    await this.#storage.deleteItem(API_KEY_STORAGE_KEYS[provider]);
  }

  async getApiKeyStatus(): Promise<ApiKeyStatusMap> {
    const [openai, gemini, elevenlabs] = await Promise.all([
      this.getApiKey("openai"),
      this.getApiKey("gemini"),
      this.getApiKey("elevenlabs"),
    ]);
    return {
      openai: openai !== null,
      gemini: gemini !== null,
      elevenlabs: elevenlabs !== null,
    };
  }
}
