import { diffLines, splitLines, type DiffOp } from "./lineDiff";

/**
 * What the approval card shows of a change: a real diff (its patch's first hunk, or a bounded
 * line diff of its recorded text), or labelled excerpts with no plus or minus, or nothing. Reads
 * at most `MAX_INPUT_CHARS` characters and cuts each shown line to `MAX_LINE_CHARS`.
 */

export interface ApprovalHunkLine {
  /**
   * `label` names an excerpt (its text is `before`, `after` or `recorded`, for the card to
   * translate); `plain` is recorded content that is not claimed as added or removed.
   */
  readonly kind: "add" | "delete" | "context" | "plain" | "label";
  readonly text: string;
  /** The file line, only where the source proves the offset. */
  readonly number: number | null;
  /** The line has no newline after it, and the other side's matching line does. */
  readonly noNewline?: true;
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
  /** The file being approved, to pick its hunk out of a patch that names several files. */
  readonly path?: string | null | undefined;
}

/** Past this many characters the card offers the full diff and reads no further. */
export const MAX_INPUT_CHARS = 200_000;
/** A shown line is cut here, so one 130,000-character line cannot become a wall of text. */
export const MAX_LINE_CHARS = 240;
const CONTEXT_LINES = 3;
/** Rows an excerpt shows of each side when there is no diff to show. */
const EXCERPT_LINES = 3;

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function shown(text: string): string {
  const row = text.replace(/\r?\n$/, "");
  return row.length > MAX_LINE_CHARS ? `${row.slice(0, MAX_LINE_CHARS)}…` : row;
}

function filePathOf(header: string): string | null {
  const quoted = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/.exec(header);
  return quoted ? quoted[2]! : null;
}

function matchesPath(filePath: string | null, wanted: string | null | undefined): boolean {
  if (filePath === null || !wanted) return false;
  const left = filePath.replaceAll("\\", "/");
  const right = wanted.replaceAll("\\", "/");
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

/**
 * The first hunk of one file in a unified patch, numbered as the patch numbers it. The header's
 * lengths end the hunk, so the next file's `---` and `+++` lines are never part of it. `path`
 * picks the file in a multi-file patch; otherwise the first file. Null when it has no hunk.
 */
export function approvalHunkPreview(
  patch: string,
  maxLines = 8,
  path?: string | null,
): ApprovalHunkPreview | null {
  const text = patch.length > MAX_INPUT_CHARS ? patch.slice(0, MAX_INPUT_CHARS) : patch;
  const scanStopped = text.length < patch.length;
  const rows = text.split("\n");
  // Each file section starts at a `diff --git` line; a patch with none is one section.
  const sections: Array<{ path: string | null; start: number; end: number }> = [];
  rows.forEach((row, index) => {
    if (row.startsWith("diff --git ")) {
      const previous = sections.at(-1);
      if (previous) previous.end = index;
      sections.push({ path: filePathOf(row), start: index + 1, end: rows.length });
    }
  });
  if (sections.length === 0) sections.push({ path: null, start: 0, end: rows.length });
  const section = sections.find((candidate) => matchesPath(candidate.path, path)) ?? sections[0]!;

  let index = section.start;
  while (index < section.end && !HUNK_HEADER.test(rows[index]!)) {
    // A header line that is not the file's own (`--- `, `+++ `, mode lines) comes before any hunk.
    index += 1;
  }
  if (index >= section.end) return null;
  const header = HUNK_HEADER.exec(rows[index]!)!;
  let oldNumber = Number(header[1]);
  let newNumber = Number(header[3]);
  let oldLeft = header[2] === undefined ? 1 : Number(header[2]);
  let newLeft = header[4] === undefined ? 1 : Number(header[4]);
  const lines: ApprovalHunkLine[] = [];
  let total = 0;
  let cursor = index + 1;
  let complete = false;
  for (; cursor < section.end; cursor += 1) {
    if (oldLeft <= 0 && newLeft <= 0) {
      complete = true;
      break;
    }
    const row = rows[cursor]!;
    if (row.startsWith("\\")) continue;
    const marker = row[0];
    // A blank row inside a hunk is an empty context line that lost its leading space.
    if (marker !== "+" && marker !== "-" && marker !== " " && row !== "") break;
    const kind = marker === "+" ? "add" : marker === "-" ? "delete" : "context";
    if (kind === "delete" && oldLeft <= 0) break;
    if (kind === "add" && newLeft <= 0) break;
    const number = kind === "delete" ? oldNumber : newNumber;
    if (kind !== "add") {
      oldNumber += 1;
      oldLeft -= 1;
    }
    if (kind !== "delete") {
      newNumber += 1;
      newLeft -= 1;
    }
    total += 1;
    if (lines.length < maxLines) lines.push({ kind, text: shown(row.slice(1)), number });
  }
  if (cursor >= section.end && oldLeft <= 0 && newLeft <= 0) complete = true;
  if (lines.length === 0) return null;
  // A hunk cut off by the scan limit cannot say how long it is.
  return { lines, hidden: scanStopped && !complete ? null : total - lines.length };
}

/** The first hunk of an edit script, with up to three lines of context on each side. */
export function firstHunkOfOps(
  ops: ReadonlyArray<DiffOp>,
  before: ReadonlyArray<string>,
  after: ReadonlyArray<string>,
  options: { readonly maxLines: number; readonly numbered: boolean },
): ApprovalHunkPreview | null {
  const first = ops.findIndex((op) => op.kind !== "equal");
  if (first === -1) return null;
  let lastChange = first;
  for (let index = first; index < ops.length; index += 1) {
    if (ops[index]!.kind !== "equal") lastChange = index;
    else if (index - lastChange > CONTEXT_LINES * 2) break;
  }
  const start = Math.max(0, first - CONTEXT_LINES);
  const end = Math.min(ops.length, lastChange + 1 + CONTEXT_LINES);
  const lines: ApprovalHunkLine[] = [];
  for (const op of ops.slice(start, end)) {
    if (lines.length >= options.maxLines) break;
    const line = (op.kind === "insert" ? after[op.newIndex] : before[op.oldIndex]) ?? "";
    const missingNewline = !line.endsWith("\n");
    lines.push({
      kind: op.kind === "equal" ? "context" : op.kind === "delete" ? "delete" : "add",
      text: shown(line),
      number: options.numbered ? (op.kind === "delete" ? op.oldIndex : op.newIndex) + 1 : null,
      ...(missingNewline && op.kind !== "equal" ? { noNewline: true as const } : {}),
    });
  }
  return { lines, hidden: end - start - lines.length };
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

/** One side's recorded content, named as such and claimed as neither added nor removed. */
function recordedContentPreview(
  text: string,
  caption: "recorded",
  maxLines: number,
): ApprovalHunkPreview | null {
  const { rows, total } = firstRows(text, maxLines - 1);
  if (total === 0) return null;
  return {
    lines: [
      { kind: "label", text: caption, number: null },
      ...rows.map((row) => ({ kind: "plain" as const, text: shown(row), number: null })),
    ],
    hidden: total - rows.length,
  };
}

/** Both sides' excerpts, labelled, for text that is too different to diff within the budget. */
function labelledExcerpts(before: string, after: string, maxLines: number): ApprovalHunkPreview {
  const each = Math.max(1, Math.min(EXCERPT_LINES, Math.floor((maxLines - 2) / 2)));
  const old = firstRows(before, each);
  const next = firstRows(after, each);
  const plain = (row: string) => ({ kind: "plain" as const, text: shown(row), number: null });
  return {
    lines: [
      { kind: "label", text: "before", number: null },
      ...old.rows.map(plain),
      { kind: "label", text: "after", number: null },
      ...next.rows.map(plain),
    ],
    hidden: old.total - old.rows.length + (next.total - next.rows.length),
  };
}

/**
 * What the card shows for the change it names: the first hunk of its patch when it has one,
 * otherwise a real diff of its recorded before and after text, otherwise labelled excerpts. A side
 * that is only missing is not an empty file: only a recorded `add` or `delete` makes it one.
 * Null means nothing to show, or too much to read here, and the card offers the full diff.
 */
export function approvalPreviewFor(
  source: ApprovalPreviewSource,
  maxLines = 8,
): ApprovalHunkPreview | null {
  if (source.diffStr?.trim()) return approvalHunkPreview(source.diffStr, maxLines, source.path);
  const { oldStr, newStr, operation } = source;
  if (oldStr == null && newStr == null) return null;
  if ((oldStr?.length ?? 0) + (newStr?.length ?? 0) > MAX_INPUT_CHARS) return null;
  if (oldStr != null && newStr != null) {
    if (oldStr === "" && operation === "add") return wholeFilePreview(newStr, "add", maxLines);
    if (newStr === "" && operation === "delete") {
      return wholeFilePreview(oldStr, "delete", maxLines);
    }
    if (oldStr === newStr) return null;
    const before = splitLines(oldStr);
    const after = splitLines(newStr);
    const ops = diffLines(before, after);
    // The recorded text may start anywhere in its file, so the lines are not numbered.
    return ops === null
      ? labelledExcerpts(oldStr, newStr, maxLines)
      : firstHunkOfOps(ops, before, after, { maxLines, numbered: false });
  }
  if (newStr != null) {
    return operation === "add"
      ? wholeFilePreview(newStr, "add", maxLines)
      : recordedContentPreview(newStr, "recorded", maxLines);
  }
  return operation === "delete"
    ? wholeFilePreview(oldStr!, "delete", maxLines)
    : recordedContentPreview(oldStr!, "recorded", maxLines);
}
