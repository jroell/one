import { describe, expect, it } from "vite-plus/test";

import { listedSystemVoices, pickSystemVoice } from "./systemVoices";

function voice(name: string, lang: string, extra: Partial<SpeechSynthesisVoice> = {}) {
  return {
    name,
    lang,
    voiceURI: name,
    default: false,
    localService: true,
    ...extra,
  } as SpeechSynthesisVoice;
}

const MAC_VOICES = [
  voice("Albert", "en-US"),
  voice("Bad News", "en-US"),
  voice("Eddy (English (United States))", "en-US"),
  voice("Samantha", "en-US", { default: true }),
  voice("Daniel", "en-GB"),
  voice("Ava (Premium)", "en-US"),
  voice("Thomas", "fr-FR"),
];

describe("pickSystemVoice", () => {
  it("reads with the most natural voice for the language, a premium voice over the device default", () => {
    expect(pickSystemVoice(MAC_VOICES, "en-US", null)?.name).toBe("Ava (Premium)");
  });

  it("never picks a novelty voice, and prefers a plain voice to the flat language-suffixed ones", () => {
    // No device default either, so only the voice quality decides.
    const withoutPremium = MAC_VOICES.filter((option) => !option.name.includes("Premium")).map(
      (option) => ({ ...option, default: false }) as SpeechSynthesisVoice,
    );
    expect(pickSystemVoice(withoutPremium, "en-US", null)?.name).toBe("Samantha");
  });

  it("uses the chosen voice when it speaks the reply's language, and ignores it when it does not", () => {
    expect(pickSystemVoice(MAC_VOICES, "en-US", "Daniel")?.name).toBe("Daniel");
    expect(pickSystemVoice(MAC_VOICES, "fr-FR", "Daniel")?.name).toBe("Thomas");
  });
});

describe("listedSystemVoices", () => {
  it("offers the voices for the language, most natural first, without novelty voices", () => {
    expect(listedSystemVoices(MAC_VOICES, "en").map((option) => option.name)).toEqual([
      "Ava (Premium)",
      "Daniel",
      "Samantha",
      "Eddy (English (United States))",
    ]);
  });
});
