import { useLayoutEffect, useRef, type RefObject } from "react";

import { useWorkspaceMode } from "./workspaceMode";

const HEADING = /^h[1-6]$/i;
const MAX_REVEAL_INDEX = 7;
/** A key term is a short bold phrase, and an answer draws a few of them at most. */
const KEY_TERM_LIMIT = 3;
const KEY_TERM_MAX_LENGTH = 40;

/**
 * The order an answer that arrives whole is revealed in: its headings first, top to bottom, then
 * the blocks under them, so the outline appears and the sections fill in beneath it. An answer
 * with no heading keeps its own order.
 */
function revealIndexes(tags: ReadonlyArray<string>): number[] {
  const headings = tags.filter((tag) => HEADING.test(tag)).length;
  let heading = 0;
  let body = 0;
  return tags.map((tag) => {
    const index = HEADING.test(tag) ? heading++ : headings + body++;
    return Math.min(index, MAX_REVEAL_INDEX);
  });
}

/** The bold phrases worth drawing a line under: short, in running text, never in code. */
function selectKeyTerms(root: ParentNode): HTMLElement[] {
  const terms: HTMLElement[] = [];
  for (const strong of root.querySelectorAll<HTMLElement>("strong")) {
    if (terms.length === KEY_TERM_LIMIT) break;
    const length = strong.textContent?.trim().length ?? 0;
    if (length < 2 || length > KEY_TERM_MAX_LENGTH) continue;
    if (strong.closest("h1, h2, h3, h4, h5, h6, pre, code, th, a, button, [data-one-statement]")) {
      continue;
    }
    terms.push(strong);
  }
  return terms;
}

/**
 * Chat mode builds an answer in front of the person. One that arrives whole shows its headings
 * first and fills the sections under them; a finished answer that was written live, or that
 * arrived whole, draws a line under a few key terms once. Opening the thread again shows neither.
 */
export function useChatBuild(rootRef: RefObject<HTMLElement | null>, streaming: boolean): void {
  const chatMode = useWorkspaceMode() === "chat";
  const wasStreaming = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- annotates the rendered blocks once the answer is on screen; only the DOM knows its blocks
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!chatMode || root === null) return;
    if (streaming) {
      wasStreaming.current = true;
      return;
    }
    const arrived = root.closest("[data-chat-arrival]") !== null;
    if (arrived) {
      const blocks = [...root.children] as HTMLElement[];
      const indexes = revealIndexes(blocks.map((block) => block.tagName));
      blocks.forEach((block, at) =>
        block.style.setProperty("--one-reveal-index", `${indexes[at]}`),
      );
    }
    if (arrived || wasStreaming.current) {
      selectKeyTerms(root).forEach((term, at) => {
        term.dataset.keyTerm = "";
        term.style.setProperty("--one-term-index", `${at}`);
      });
    }
    wasStreaming.current = false;
  }, [chatMode, streaming, rootRef]);
}
