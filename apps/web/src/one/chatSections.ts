import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";

/** One heading of an answer, as the outline lists it under the turn it belongs to. */
export interface ChatSection {
  /** Stable while the answer streams: the message and the heading's place in it. */
  readonly id: string;
  readonly messageId: string;
  /** The assistant row to scroll to. */
  readonly rowIndex: number;
  /** Which of the message's headings this is, counting from 0. */
  readonly headingIndex: number;
  readonly text: string;
  /** The section's text has finished: another heading follows it, or the answer ended. */
  readonly complete: boolean;
}

const HEADING = /^ {0,3}(#{1,3})[ \t]+(.+?)[ \t#]*$/;
/** A fence opens with three or more backticks or tildes, at most three spaces in (CommonMark). */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const SECTION_CACHE_LIMIT = 2000;

interface Parsed {
  readonly text: string;
  readonly streaming: boolean;
  readonly headings: ReadonlyArray<string>;
}
const cache = new Map<string, Parsed>();

function plainHeading(source: string): string {
  return source
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type Fence = { readonly char: string; readonly length: number };

/**
 * Moves through a message one line at a time, outside and inside code fences, by the CommonMark
 * rule: a fence closes only on the same character, at least as long, with nothing after it, and a
 * backtick fence's info string cannot hold a backtick ("```js code```" is inline code). `onFence`
 * is true for the line that opens a fence, every line inside it and the line that closes it.
 */
export function stepFence(
  fence: Fence | null,
  line: string,
): { fence: Fence | null; onFence: boolean } {
  if (fence !== null) {
    const closing = FENCE_CLOSE.exec(line)?.[1];
    const closes =
      closing !== undefined && closing[0] === fence.char && closing.length >= fence.length;
    return { fence: closes ? null : fence, onFence: true };
  }
  const opening = FENCE_OPEN.exec(line);
  if (opening !== null && !(opening[1]![0] === "`" && opening[2]!.includes("`"))) {
    return { fence: { char: opening[1]![0]!, length: opening[1]!.length }, onFence: true };
  }
  return { fence: null, onFence: false };
}

/**
 * The headings of a message's text, outside code fences. While the answer streams, a heading
 * counts once its line has ended, so a half-typed title never shows in the outline.
 */
export function parseChatHeadings(text: string, streaming: boolean): string[] {
  const lines = text.split("\n");
  const headings: string[] = [];
  let fence: Fence | null = null;
  for (const [index, line] of lines.entries()) {
    const step = stepFence(fence, line);
    fence = step.fence;
    if (step.onFence) continue;
    const heading = HEADING.exec(line);
    if (heading === null) continue;
    if (streaming && index === lines.length - 1) continue;
    const label = plainHeading(heading[2]!);
    if (label.length > 0) headings.push(label);
  }
  return headings;
}

function cachedHeadings(id: string, text: string, streaming: boolean): ReadonlyArray<string> {
  const cached = cache.get(id);
  if (cached?.text === text && cached.streaming === streaming) return cached.headings;
  if (cache.size >= SECTION_CACHE_LIMIT) cache.clear();
  const headings = parseChatHeadings(text, streaming);
  cache.set(id, { text, streaming, headings });
  return headings;
}

export const NO_CHAT_SECTIONS: ReadonlyMap<string, ReadonlyArray<ChatSection>> = new Map();

/**
 * The sections of each turn's answers, keyed by the turn's user row id. A turn with no heading in
 * its answers has no entry.
 */
export function deriveChatSections(
  rows: ReadonlyArray<MessagesTimelineRow>,
): ReadonlyMap<string, ReadonlyArray<ChatSection>> {
  const byTurn = new Map<string, ChatSection[]>();
  let turnId: string | null = null;
  for (const [rowIndex, row] of rows.entries()) {
    if (row.kind !== "message") continue;
    if (row.message.role === "user") {
      turnId = row.id;
      continue;
    }
    if (row.message.role !== "assistant" || turnId === null) continue;
    const streaming = row.message.streaming;
    const headings = cachedHeadings(row.message.id, row.message.text, streaming);
    for (const [headingIndex, text] of headings.entries()) {
      const list = byTurn.get(turnId) ?? [];
      list.push({
        id: `${row.message.id}:${headingIndex}`,
        messageId: row.message.id,
        rowIndex,
        headingIndex,
        text,
        complete: !streaming || headingIndex < headings.length - 1,
      });
      byTurn.set(turnId, list);
    }
  }
  return byTurn.size === 0 ? NO_CHAT_SECTIONS : byTurn;
}
