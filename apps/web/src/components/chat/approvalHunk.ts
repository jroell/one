/**
 * The few lines an approval card shows of the change it asks about. Everything here is linear in
 * the input and bounded: the work reads at most `MAX_INPUT_CHARS` characters, and each shown line
 * is cut to `MAX_LINE_CHARS`. The card never runs a diff search, so a large or dissimilar edit
 * cannot hold up the Approve and Decline buttons.
 */

export interface ApprovalHunkLine {
  /** `plain` is recorded content that is neither proven added nor removed. */
  readonly kind: "add" | "delete" | "context" | "plain";
  readonly text: string;
  /** The file line, only where the source proves the offset. */
  readonly number: number | null;
}

export interface ApprovalHunkPreview {
  readonly lines: ReadonlyArray<ApprovalHunkLine>;
  /** Lines of the same hunk past the preview, or null when the scan stopped before the end. */
  readonly hidden: number | null;
}

export interface ApprovalPreviewSource {
  readonly diffStr?: string | null | undefined;
  readonly oldStr?: string | null | undefined;
  readonly newStr?: string | null | undefined;
  /** The recorded file operation: only `add` and `delete` prove one side of the file is empty. */
  readonly operation?: string | null | undefined;
}

/** Past this many characters the card offers the full diff and reads no further. */
export const MAX_INPUT_CHARS = 200_000;
/** A shown line is cut here, so one 130,000-character line cannot become a wall of text. */
export const MAX_LINE_CHARS = 240;
const CONTEXT_LINES = 3;

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function shown(text: string): string {
  const row = text.endsWith("\r") ? text.slice(0, -1) : text;
  return row.length > MAX_LINE_CHARS ? `${row.slice(0, MAX_LINE_CHARS)}…` : row;
}

/** Text lines without a final empty one, the way a file with a closing newline reads. */
function linesOf(text: string): string[] {
  const rows = text.split("\n");
  if (rows.length > 1 && rows.at(-1) === "") rows.pop();
  return rows;
}

/**
 * The first hunk of a unified patch, cut to a few lines, numbered the way the patch numbers
 * them: added and context lines by new-file line, deleted lines by old-file line. Only the first
 * `MAX_INPUT_CHARS` characters are read; when the hunk runs past them the remainder is unknown.
 * Null when the patch has no hunk, so the card shows nothing rather than a guess.
 */
export function approvalHunkPreview(patch: string, maxLines = 8): ApprovalHunkPreview | null {
  const text = patch.length > MAX_INPUT_CHARS ? patch.slice(0, MAX_INPUT_CHARS) : patch;
  const scanStopped = text.length < patch.length;
  let position = 0;
  let oldNumber = 0;
  let newNumber = 0;
  let inHunk = false;
  const lines: ApprovalHunkLine[] = [];
  let total = 0;
  while (position <= text.length) {
    let end = text.indexOf("\n", position);
    if (end === -1) end = text.length;
    const row = text.slice(position, end);
    position = end + 1;
    if (!inHunk) {
      const header = HUNK_HEADER.exec(row);
      if (header) {
        inHunk = true;
        oldNumber = Number(header[1]);
        newNumber = Number(header[2]);
      }
      continue;
    }
    if (row.startsWith("@@") || row.startsWith("diff --git")) break;
    if (row.startsWith("\\")) continue;
    const marker = row[0];
    if (marker !== "+" && marker !== "-" && marker !== " ") continue;
    total += 1;
    const kind = marker === "+" ? "add" : marker === "-" ? "delete" : "context";
    const number = kind === "delete" ? oldNumber : newNumber;
    if (kind !== "add") oldNumber += 1;
    if (kind !== "delete") newNumber += 1;
    if (lines.length < maxLines) lines.push({ kind, text: shown(row.slice(1)), number });
  }
  if (lines.length === 0) return null;
  // A scan that stopped at the limit may have cut the last row short and cannot count the rest.
  return { lines, hidden: scanStopped ? null : total - lines.length };
}

/** The first rows of a text, and how many it has, without splitting all of it. */
function firstRows(text: string, count: number): { rows: string[]; total: number } {
  const rows: string[] = [];
  let position = 0;
  let total = 0;
  while (position < text.length) {
    let end = text.indexOf("\n", position);
    if (end === -1) end = text.length;
    total += 1;
    if (rows.length < count) rows.push(text.slice(position, end));
    position = end + 1;
  }
  return { rows, total };
}

/** A whole file the change adds or removes: its first lines, numbered from 1. */
function wholeFilePreview(
  text: string,
  kind: "add" | "delete",
  maxLines: number,
): ApprovalHunkPreview | null {
  const { rows, total } = firstRows(text, maxLines);
  if (total === 0) return null;
  return {
    lines: rows.map((row, index) => ({ kind, text: shown(row), number: index + 1 })),
    hidden: total - rows.length,
  };
}

/** Recorded content of one side: shown as recorded, with no sign and no number. */
function recordedContentPreview(text: string, maxLines: number): ApprovalHunkPreview | null {
  const { rows, total } = firstRows(text, maxLines);
  if (total === 0) return null;
  return {
    lines: rows.map((row) => ({ kind: "plain" as const, text: shown(row), number: null })),
    hidden: total - rows.length,
  };
}

/**
 * Before and after text with no known file offset (an excerpt a provider recorded). Lines the two
 * share at the start and end are trimmed away in one pass, so the cost is linear; what remains is
 * shown as removed, then added. It is never numbered, since the excerpt may start anywhere.
 */
function excerptPreview(
  before: string,
  after: string,
  maxLines: number,
): ApprovalHunkPreview | null {
  if (before === after) return null;
  const oldRows = linesOf(before);
  const newRows = linesOf(after);
  let prefix = 0;
  const limit = Math.min(oldRows.length, newRows.length);
  while (prefix < limit && oldRows[prefix] === newRows[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    oldRows[oldRows.length - 1 - suffix] === newRows[newRows.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const removed = oldRows.slice(prefix, oldRows.length - suffix);
  const added = newRows.slice(prefix, newRows.length - suffix);
  if (removed.length === 0 && added.length === 0) return null;
  const leading = oldRows.slice(Math.max(0, prefix - CONTEXT_LINES), prefix);
  const trailing = oldRows.slice(oldRows.length - suffix, oldRows.length - suffix + CONTEXT_LINES);
  const all: ApprovalHunkLine[] = [
    ...leading.map((row) => ({ kind: "context" as const, text: shown(row), number: null })),
    ...removed.map((row) => ({ kind: "delete" as const, text: shown(row), number: null })),
    ...added.map((row) => ({ kind: "add" as const, text: shown(row), number: null })),
    ...trailing.map((row) => ({ kind: "context" as const, text: shown(row), number: null })),
  ];
  return { lines: all.slice(0, maxLines), hidden: Math.max(0, all.length - maxLines) };
}

/**
 * What the card shows for the change it names: the first hunk of its patch when it has one,
 * otherwise its recorded before and after text. A side that is only missing is not an empty
 * file: only a recorded `add` or `delete` makes it one. Null means nothing to show, or too much to
 * read here, and the card offers the full diff.
 */
export function approvalPreviewFor(
  source: ApprovalPreviewSource,
  maxLines = 8,
): ApprovalHunkPreview | null {
  if (source.diffStr?.trim()) return approvalHunkPreview(source.diffStr, maxLines);
  const { oldStr, newStr, operation } = source;
  if (oldStr == null && newStr == null) return null;
  if ((oldStr?.length ?? 0) + (newStr?.length ?? 0) > MAX_INPUT_CHARS) return null;
  if (oldStr != null && newStr != null) {
    if (oldStr === "" && operation === "add") return wholeFilePreview(newStr, "add", maxLines);
    if (newStr === "" && operation === "delete") {
      return wholeFilePreview(oldStr, "delete", maxLines);
    }
    return excerptPreview(oldStr, newStr, maxLines);
  }
  if (newStr != null) {
    return operation === "add"
      ? wholeFilePreview(newStr, "add", maxLines)
      : recordedContentPreview(newStr, maxLines);
  }
  return operation === "delete"
    ? wholeFilePreview(oldStr!, "delete", maxLines)
    : recordedContentPreview(oldStr!, maxLines);
}
