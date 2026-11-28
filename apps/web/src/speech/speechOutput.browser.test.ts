import { expect, it, vi } from "vite-plus/test";

import { stubGlobal } from "../../test/render";
import { createSystemEngine } from "./speechOutput";

function voice(name: string, lang: string): SpeechSynthesisVoice {
  return { name, lang, default: false, localService: true, voiceURI: name };
}

/** The browser only accepts the voices it listed itself, so these tests listen to a plain utterance. */
class PlainUtterance {
  voice: SpeechSynthesisVoice | null = null;
  lang = "";
  pitch = 1;
  rate = 1;
  constructor(readonly text: string) {}
}

async function firstUtterance(voiceURI: string | null) {
  const spoken = Promise.withResolvers<PlainUtterance>();
  using _utterance = stubGlobal("SpeechSynthesisUtterance", PlainUtterance);
  using _voices = vi
    .spyOn(window.speechSynthesis, "getVoices")
    .mockReturnValue([voice("Samantha", "en-US"), voice("Daniel (Enhanced)", "en-GB")]);
  using _speak = vi
    .spyOn(window.speechSynthesis, "speak")
    .mockImplementation((utterance) => spoken.resolve(utterance as unknown as PlainUtterance));
  using _cancel = vi.spyOn(window.speechSynthesis, "cancel").mockImplementation(() => undefined);
  const engine = createSystemEngine({ voiceURI, rate: 1, pageLanguage: "en-US" });
  const stop = new AbortController();
  const playing = engine!
    .prepare({ text: "Hello there.", start: 0 })
    .play({ onStart: () => undefined, onProgress: () => undefined }, stop.signal)
    .catch(() => undefined);
  const first = await spoken.promise;
  stop.abort();
  await playing;
  return first;
}

it("the default Conqueror voice reads lower and slower in the voice picked in Settings, and in the deepest device voice when none was picked", async () => {
  const picked = await firstUtterance("Samantha");
  expect(picked?.voice?.name).toBe("Samantha");
  expect(picked?.pitch).toBeLessThan(0.5);
  expect(picked?.rate).toBeLessThan(1);

  const unpicked = await firstUtterance(null);
  expect(unpicked?.voice?.name).toBe("Daniel (Enhanced)");
  expect(unpicked?.pitch).toBeLessThan(0.5);
});
