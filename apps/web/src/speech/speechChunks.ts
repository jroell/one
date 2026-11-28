/** One stretch of text the speech engine reads in a single request, and where it starts. */
export type SpeechChunk = Readonly<{ text: string; start: number }>;

/** Browsers stop some voices about fifteen seconds into one utterance; this stays well under that. */
const MAX_CHUNK_CHARS = 240;
/** Sentences shorter than this ride along with the next one, so the voice does not stop after each. */
const MERGE_BELOW_CHARS = 60;

const SENTENCE_END = /[.!?…。！？]+["'”’)\]]*(?=\s|$)|\n+/g;

function splitLong(text: string, start: number): SpeechChunk[] {
  const pieces: SpeechChunk[] = [];
  let rest = text;
  let offset = start;
  while (rest.length > MAX_CHUNK_CHARS) {
    const window = rest.slice(0, MAX_CHUNK_CHARS);
    const clause = Math.max(
      window.lastIndexOf(", "),
      window.lastIndexOf("; "),
      window.lastIndexOf(": "),
    );
    const space = window.lastIndexOf(" ");
    const cut = clause > MAX_CHUNK_CHARS / 3 ? clause + 1 : space > 0 ? space : MAX_CHUNK_CHARS;
    const piece = rest.slice(0, cut);
    const trimmed = piece.trim();
    if (trimmed) pieces.push({ text: trimmed, start: offset + piece.indexOf(trimmed) });
    offset += cut;
    rest = rest.slice(cut);
  }
  const trimmed = rest.trim();
  if (trimmed) pieces.push({ text: trimmed, start: offset + rest.indexOf(trimmed) });
  return pieces;
}

/** The sentences of `text`, each with the offset it starts at, in order. */
export function speechSentences(text: string): SpeechChunk[] {
  const sentences: SpeechChunk[] = [];
  let from = 0;
  for (const match of text.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length;
    const raw = text.slice(from, end);
    const trimmed = raw.trim();
    if (trimmed) sentences.push(...splitLong(trimmed, from + raw.indexOf(trimmed)));
    from = end;
  }
  const raw = text.slice(from);
  const trimmed = raw.trim();
  if (trimmed) sentences.push(...splitLong(trimmed, from + raw.indexOf(trimmed)));
  return sentences;
}

/**
 * Splits speakable text into the stretches the engine reads one at a time. Short sentences are
 * joined up to a limit, so the voice keeps a natural pace instead of pausing after each one. With
 * `firstAlone`, the first sentence stays on its own, so a voice that is fetched starts sooner.
 */
export function speechChunks(
  text: string,
  options: { readonly firstAlone?: boolean } = {},
): SpeechChunk[] {
  const chunks: SpeechChunk[] = [];
  const firstAlone = options.firstAlone === true;
  for (const sentence of speechSentences(text)) {
    const previous = chunks.at(-1);
    if (
      previous !== undefined &&
      (!firstAlone || chunks.length > 1) &&
      previous.text.length < MERGE_BELOW_CHARS &&
      sentence.start - previous.start + sentence.text.length <= MAX_CHUNK_CHARS
    ) {
      chunks[chunks.length - 1] = {
        start: previous.start,
        text: text.slice(previous.start, sentence.start + sentence.text.length),
      };
      continue;
    }
    chunks.push(sentence);
  }
  return chunks;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const LAST_SENTENCE_END = /[.!?…]["'”’)\]]*\s(?![\s\S]*[.!?…]["'”’)\]]*\s)/;

/**
 * The part of a reply that is still being written which can already be read: whole lines, then the
 * finished sentences of the line being written. A table at the end is held back until a line
 * after it arrives, because its spoken form counts its rows; so is anything inside an open code
 * block or a heading still being typed.
 */
export function settledMarkdown(markdown: string): string {
  const lastBreak = markdown.lastIndexOf("\n");
  const lines = lastBreak === -1 ? [] : markdown.slice(0, lastBreak).split("\n");
  const partial = markdown.slice(lastBreak + 1);
  let tableStart = lines.length;
  while (tableStart > 0 && (lines[tableStart - 1] ?? "").includes("|")) tableStart -= 1;
  const heldTable = tableStart < lines.length;
  const whole = lines.slice(0, tableStart).join("\n");
  const fenceOpen = lines.filter((line) => FENCE.test(line)).length % 2 === 1;
  if (heldTable || fenceOpen || partial.includes("|") || /^\s{0,3}(#|`{3,}|~{3,})/.test(partial)) {
    return whole;
  }
  const end = LAST_SENTENCE_END.exec(partial);
  if (!end) return whole;
  const sentences = partial.slice(0, end.index + end[0].length).trimEnd();
  return whole ? `${whole}\n${sentences}` : sentences;
}

/**
 * The text as the engine should say it: a line that ends without punctuation (a list item, a
 * heading) gets a full stop, so the voice pauses there instead of running the lines together.
 */
export function spokenForm(text: string): string {
  return text.replace(/([^\s.!?…:;,])\n/g, "$1.\n");
}
