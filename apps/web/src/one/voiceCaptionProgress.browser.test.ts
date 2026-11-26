import { describe, expect, it } from "vite-plus/test";

import {
  captionWords,
  createCaptionProgress,
  estimatedSentenceTimesMs,
  sentenceStarts,
  SPOKEN_CLASS,
} from "./voiceCaptionProgress";

const TEXT = "Light bends. It splits into colors! Why?\nBecause glass.";

function caption(text: string): HTMLElement {
  const root = document.createElement("p");
  for (const word of captionWords(text)) {
    const span = document.createElement("span");
    span.dataset.start = String(word.start);
    span.textContent = word.text;
    root.append(span, " ");
  }
  return root;
}

const spoken = (root: HTMLElement) =>
  [...root.querySelectorAll("span")]
    .filter((span) => span.classList.contains(SPOKEN_CLASS))
    .map((span) => span.textContent);

describe("where each sentence of a caption starts", () => {
  it("starts a sentence after a stop, a question mark, an exclamation mark or a line break", () => {
    expect(sentenceStarts(TEXT).map((start) => TEXT.slice(start, start + 4))).toEqual([
      "Ligh",
      "It s",
      "Why?",
      "Beca",
    ]);
  });

  it("spaces estimated sentence times by how much text came before them", () => {
    const times = estimatedSentenceTimesMs(TEXT, 10);
    expect(times[0]).toBe(0);
    expect(times).toEqual([...times].toSorted((a, b) => a - b));
    expect(times[1]).toBe(Math.round((TEXT.indexOf("It") / 10) * 1000));
  });
});

describe("marking caption words as spoken", () => {
  it("warms each word the voice has reached, in order, and none ahead of it", () => {
    const root = caption(TEXT);
    const progress = createCaptionProgress(root);
    progress.reach(0);
    expect(spoken(root)).toEqual(["Light"]);
    progress.reach(TEXT.indexOf("splits"));
    expect(spoken(root)).toEqual(["Light", "bends.", "It", "splits"]);
    progress.reach(TEXT.indexOf("It"));
    expect(spoken(root)).toHaveLength(4);
  });

  it("tells which word the voice is on so the transcript can follow it", () => {
    const root = caption(TEXT);
    const active: Array<string | null> = [];
    const progress = createCaptionProgress(root, (word) => active.push(word.textContent));
    progress.reach(0);
    progress.reach(TEXT.indexOf("into"));
    progress.reach(TEXT.indexOf("into"));
    expect(active).toEqual(["Light", "into"]);
  });

  it("warms a whole sentence at once when the engine gives no word timing", () => {
    const root = caption(TEXT);
    const progress = createCaptionProgress(root);
    progress.reachSentence(0, TEXT);
    expect(spoken(root)).toEqual(["Light", "bends."]);
    progress.reachSentence(TEXT.indexOf("It"), TEXT);
    expect(spoken(root)).toEqual(["Light", "bends.", "It", "splits", "into", "colors!"]);
    progress.reachSentence(TEXT.indexOf("Because"), TEXT);
    expect(spoken(root)).toHaveLength(captionWords(TEXT).length);
  });
});
