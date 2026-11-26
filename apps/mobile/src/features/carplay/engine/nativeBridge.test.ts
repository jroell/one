import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("expo-audio", () => ({
  getRecordingPermissionsAsync: vi.fn(async () => ({ granted: true })),
  requestRecordingPermissionsAsync: vi.fn(async () => ({ granted: true })),
}));

vi.mock("@t3tools/mobile-carplay-native", () => ({}));

import { toNativeDashboardState } from "./nativeBridge";
import type { CarPlaySyncPayload } from "./types";

const PAYLOAD: CarPlaySyncPayload = {
  sessionState: "speaking",
  isMuted: false,
  activeVoiceId: "marin",
  activeVoiceName: "Marin",
  activePersonaId: "copilot",
  activePersonaName: "Road Co-Pilot",
  activeTopic: "Evening commute",
  activeCaption: "Your build passed and the deploy is live on staging.",
  voices: [
    {
      id: "marin",
      name: "Marin",
      detail: "Warm and clear",
      vibe: "warm",
      isFavorite: false,
      isSelected: true,
    },
  ],
  personas: [{ id: "copilot", name: "Road Co-Pilot", detail: "Companion", isSelected: true }],
  threads: [
    {
      id: "env:thread-1",
      title: "Refactor auth middleware",
      status: "running",
      badge: "2m ago",
      isSelected: true,
    },
  ],
};

describe("toNativeDashboardState", () => {
  it("never sends the assistant's answer text to the CarPlay scene", () => {
    const state = toNativeDashboardState(PAYLOAD);

    expect(JSON.stringify(state)).not.toContain("deploy is live");
  });

  it("keeps an active session for every in-conversation phase and ends it on idle or error", () => {
    const active = (sessionState: CarPlaySyncPayload["sessionState"]) =>
      toNativeDashboardState({ ...PAYLOAD, sessionState }).sessionActive;

    expect(
      (["connecting", "listening", "thinking", "speaking", "muted", "interrupted"] as const).map(
        active,
      ),
    ).toEqual([true, true, true, true, true, true]);
    expect([active("idle"), active("error")]).toEqual([false, false]);
  });

  it("reports an interrupted turn as listening so voice control shows the microphone state", () => {
    expect(toNativeDashboardState({ ...PAYLOAD, sessionState: "interrupted" }).phase).toBe(
      "listening",
    );
  });

  it("sends the CarPlay labels and a translated section header for each voice", () => {
    const state = toNativeDashboardState(PAYLOAD);

    expect(state.labels?.startTalking).toBe("Start talking");
    expect(state.labels?.stateListening).toBe("Listening");
    expect(state.voices[0]?.group).toBe("Warm");
    expect(state.threads[0]).toMatchObject({
      title: "Refactor auth middleware",
      statusLabel: "2m ago",
    });
  });
});
