import { describe, expect, it } from "vite-plus/test";

import { applyVoiceChatStyle, replyLanguage } from "./voiceChatPreferences";

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

describe("language a reply is read in", () => {
  it("reads in the page language unless the reply is plainly written in another script", () => {
    expect(replyLanguage("Light bends inside each drop.", "en-US")).toBe("en-US");
    expect(replyLanguage("光は水滴の中で曲がります。ありがとう。", "en-US")).toBe("ja");
    expect(replyLanguage("Свет преломляется в каждой капле.", "en-US")).toBe("ru");
  });

  it("reads Han-only text in the page language on a Japanese or Korean page, and as Chinese elsewhere", () => {
    const hanOnly = "大气光散射屈折现象青空天空物理原理";
    expect(replyLanguage(hanOnly, "ja-JP")).toBe("ja-JP");
    expect(replyLanguage(hanOnly, "ko-KR")).toBe("ko-KR");
    expect(replyLanguage(hanOnly, "en-US")).toBe("zh");
  });

  it("reads Han text with a little kana or hangul in that language, whatever the page says", () => {
    const withKana = "大気光学の光散乱屈折現象青空天空物理原理波長粒子大気中拡散反射透過のしくみ";
    expect(replyLanguage(withKana, "en-US")).toBe("ja");
    expect(replyLanguage(withKana, "zh-CN")).toBe("ja");
    expect(replyLanguage("大氣光散射屈折現象青空天空物理原理가", "en-US")).toBe("ko");
  });

  it("keeps a Chinese page's language when one kana letter ends a short Chinese sentence", () => {
    expect(replyLanguage("光線反射あ", "zh-CN")).toBe("zh-CN");
    expect(replyLanguage("光線反射あ", "en-US")).toBe("zh");
    expect(replyLanguage("光線反射ありがとう", "zh-CN")).toBe("ja");
  });

  it("keeps a Chinese page's language when a middle dot or one stray kana letter sits in Chinese text", () => {
    expect(replyLanguage("光在每一滴水中发生折射・反射或散射。", "zh-CN")).toBe("zh-CN");
    expect(replyLanguage("光在每一滴水中发生折射・反射或散射。", "en-US")).toBe("zh");
    expect(replyLanguage("光在每一滴水中发生折射，日语里把它写作の，意思相近。", "zh-CN")).toBe(
      "zh-CN",
    );
  });

  it("keeps the page language when it is one of the languages written in that script", () => {
    expect(replyLanguage("Світло заломлюється в кожній краплі.", "uk-UA")).toBe("uk-UA");
  });

  it("keeps the page language when one word in another script is quoted inside the reply", () => {
    expect(replyLanguage("The Japanese word 水 means water, and it is read mizu.", "en-GB")).toBe(
      "en-GB",
    );
  });
});
