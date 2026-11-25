import { describe, expect, it } from "vite-plus/test";

import { applyVoiceChatStyle } from "./voiceChatPreferences";

function voice(name: string, lang: string): SpeechSynthesisVoice {
  return { name, lang, default: false, localService: true, voiceURI: name };
}

function utterance(lang: string) {
  return { lang, pitch: 1, rate: 1, voice: null } as unknown as SpeechSynthesisUtterance;
}

describe("voice chat reading style", () => {
  const voices = [
    voice("Samantha", "en-US"),
    voice("Fred", "en-US"),
    voice("Daniel (Enhanced)", "en-GB"),
    voice("Thomas", "fr-FR"),
  ];

  it("reads in the Conqueror style with the deepest listed voice of the reply's language, lower and slower", () => {
    const spoken = utterance("en-US");
    applyVoiceChatStyle(spoken, voices, "conqueror");
    expect(spoken.voice?.name).toBe("Daniel (Enhanced)");
    expect(spoken.pitch).toBeLessThan(0.5);
    expect(spoken.rate).toBeLessThan(1);
  });

  it("keeps the device voice for a language with no listed deep voice, still lower and slower", () => {
    const spoken = utterance("fr-FR");
    applyVoiceChatStyle(spoken, voices, "conqueror");
    expect(spoken.voice).toBeNull();
    expect(spoken.pitch).toBeLessThan(0.5);
  });

  it("leaves the voice and pitch alone in the natural style", () => {
    const spoken = utterance("en-US");
    applyVoiceChatStyle(spoken, voices, "natural");
    expect(spoken.voice).toBeNull();
    expect(spoken.pitch).toBe(1);
  });
});
