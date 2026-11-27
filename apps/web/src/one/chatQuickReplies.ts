import { msg } from "gt-react";

import { m } from "~/i18n/messages";

/** What follows an answer: nothing for a one-liner, replies when it asks, else the three follow-ups. */
export type ChatAnswerEnding =
  | { readonly kind: "none" }
  | { readonly kind: "follow-ups" }
  | { readonly kind: "replies"; readonly replies: ReadonlyArray<string> };

const YES = msg("Yes");
const NO = msg("No");
const NOT_SURE = msg("Not sure");
const SKIP = msg("Skip that and give me your best recommendation.");

const YES_NO_OPENERS = new Set([
  "do",
  "does",
  "did",
  "is",
  "are",
  "was",
  "were",
  "can",
  "could",
  "will",
  "would",
  "should",
  "have",
  "has",
  "shall",
  "may",
  "might",
]);

/** Markdown and quotes that can trail a question without changing that it is one. */
const TRAILING_MARKUP = /[\s*_"'”’)\]]+$/u;

function lastParagraph(text: string): string {
  const paragraphs = text.trim().split(/\n\s*\n/u);
  return paragraphs.at(-1)?.trim() ?? "";
}

/** The final sentence of the final paragraph, without list markers or emphasis marks. */
function lastSentence(paragraph: string): string {
  const flat = paragraph
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gmu, "")
    .replace(/[*_`]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  const sentences = flat.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/gu) ?? [];
  return sentences.at(-1)?.trim() ?? flat;
}

function sentenceCount(text: string): number {
  return (text.replace(/```[\s\S]*?```/gu, " ").match(/[^.!?\n]+[.!?]+(?=\s|$)/gu) ?? []).length;
}

/**
 * Reads how an answer ends. An answer that asks the person something gets replies they can send
 * in one press (yes, no, not sure for a yes-or-no question; not sure and skip for any other), an
 * answer under two sentences gets nothing, and the rest keep the three follow-ups. Reading the
 * text is all this does: no model decides what the replies are.
 */
export function readAnswerEnding(text: string): ChatAnswerEnding {
  const paragraph = lastParagraph(text);
  const question = paragraph.replace(TRAILING_MARKUP, "").endsWith("?");
  if (question) {
    const sentence = lastSentence(paragraph);
    const first =
      sentence
        .split(/\s+/u)[0]
        ?.toLowerCase()
        .replace(/[^a-z]/gu, "") ?? "";
    // A question that offers a choice ("a hub or an HTTP source?") is not answered by yes or no.
    const choice = /\bor\b/iu.test(sentence);
    return {
      kind: "replies",
      replies:
        YES_NO_OPENERS.has(first) && !choice
          ? [m(YES), m(NO), m(NOT_SURE)]
          : [m(NOT_SURE), m(SKIP)],
    };
  }
  return sentenceCount(text) < 2 ? { kind: "none" } : { kind: "follow-ups" };
}
