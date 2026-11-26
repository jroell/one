/** A word of the caption and where it starts in the text the voice reads. */
export type CaptionWord = Readonly<{ text: string; start: number }>;

export function captionWords(text: string): ReadonlyArray<CaptionWord> {
  return [...text.matchAll(/\S+/g)].map((match) => ({ text: match[0], start: match.index ?? 0 }));
}

/** Where each sentence starts: after a stop, question or exclamation mark, or a line break. */
export function sentenceStarts(text: string): ReadonlyArray<number> {
  const starts = [0];
  for (const match of text.matchAll(/([.!?]["')\]]*\s+|\n+)(?=\S)/g)) {
    starts.push((match.index ?? 0) + match[0].length);
  }
  return starts;
}

/** About how long a voice takes over the text before each sentence, for an engine that reports no word timing. */
export function estimatedSentenceTimesMs(
  text: string,
  charactersPerSecond = 14,
): ReadonlyArray<number> {
  return sentenceStarts(text).map((start) => Math.round((start / charactersPerSecond) * 1000));
}

export type CaptionProgress = Readonly<{
  /** The voice reached `char`: every word that starts at or before it has been spoken. */
  reach: (char: number) => void;
  /** Without word timing: the voice reached the sentence that starts at `start`; its words warm together. */
  reachSentence: (start: number, text: string) => void;
}>;

export const SPOKEN_CLASS = "is-spoken";

/**
 * Marks words of an already rendered caption as spoken, in order. Each word is an element with
 * `data-start`; the class change is the only write, so a long reply costs no React render per word.
 * `onActive` gets the word the voice is on, for scrolling.
 */
export function createCaptionProgress(
  root: ParentNode,
  onActive?: (word: HTMLElement) => void,
): CaptionProgress {
  const words = [...root.querySelectorAll<HTMLElement>("[data-start]")];
  const starts = words.map((word) => Number(word.dataset.start));
  let next = 0;
  const reach = (char: number) => {
    let last: HTMLElement | null = null;
    while (next < words.length && (starts[next] ?? Infinity) <= char) {
      const word = words[next];
      word?.classList.add(SPOKEN_CLASS);
      last = word ?? last;
      next += 1;
    }
    if (last) onActive?.(last);
  };
  return {
    reach,
    reachSentence: (start, text) => {
      const following = sentenceStarts(text).find((candidate) => candidate > start);
      reach((following ?? Infinity) - 1);
    },
  };
}
