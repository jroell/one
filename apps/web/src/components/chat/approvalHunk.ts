import { parseDiffFromFile } from "@pierre/diffs";

export interface ApprovalHunkLine {
  readonly kind: "add" | "delete" | "context";
  readonly text: string;
  readonly number: number;
}

export interface ApprovalHunkPreview {
  readonly lines: ReadonlyArray<ApprovalHunkLine>;
  /** Lines of the same hunk past the preview. */
  readonly hidden: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * The first hunk of a patch, cut to a few lines, numbered the way the diff numbers them: added
 * and context lines by new-file line, deleted lines by old-file line. Null when the patch has no
 * hunk, so the card shows nothing rather than a guess.
 */
export function approvalHunkPreview(patch: string, maxLines = 8): ApprovalHunkPreview | null {
  const rows = patch.split("\n");
  const start = rows.findIndex((row) => HUNK_HEADER.test(row));
  if (start === -1) return null;
  const header = HUNK_HEADER.exec(rows[start]!)!;
  let oldNumber = Number(header[1]);
  let newNumber = Number(header[2]);
  const lines: ApprovalHunkLine[] = [];
  let total = 0;
  for (const row of rows.slice(start + 1)) {
    if (row.startsWith("@@") || row.startsWith("diff --git")) break;
    if (row.startsWith("\\")) continue;
    const marker = row[0];
    if (marker !== "+" && marker !== "-" && marker !== " ") continue;
    total += 1;
    const kind = marker === "+" ? "add" : marker === "-" ? "delete" : "context";
    const number = kind === "delete" ? oldNumber : newNumber;
    if (kind !== "add") oldNumber += 1;
    if (kind !== "delete") newNumber += 1;
    if (lines.length < maxLines) lines.push({ kind, text: row.slice(1), number });
  }
  return lines.length === 0 ? null : { lines, hidden: total - lines.length };
}

/** Past this many characters the preview is skipped and "Show full diff" is the way in. */
const MAX_PREVIEW_INPUT_CHARS = 100_000;

export interface ApprovalPreviewSource {
  readonly diffStr?: string | null | undefined;
  readonly oldStr?: string | null | undefined;
  readonly newStr?: string | null | undefined;
}

function lineText(line: string | undefined): string {
  return (line ?? "").replace(/\r?\n$/, "");
}

/** All lines of a file the change adds or removes whole: the first few, numbered from 1. */
function wholeFilePreview(
  text: string,
  kind: "add" | "delete",
  maxLines: number,
): ApprovalHunkPreview | null {
  const rows = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  if (rows.length === 1 && rows[0] === "") return null;
  return {
    lines: rows.slice(0, maxLines).map((row, index) => ({ kind, text: row, number: index + 1 })),
    hidden: Math.max(0, rows.length - maxLines),
  };
}

/** The first hunk of a change given as before and after text, as providers like ACP send it. */
function hunkFromContents(
  oldText: string,
  newText: string,
  maxLines: number,
): ApprovalHunkPreview | null {
  if (oldText === newText) return null;
  if (oldText === "") return wholeFilePreview(newText, "add", maxLines);
  if (newText === "") return wholeFilePreview(oldText, "delete", maxLines);
  const file = parseDiffFromFile(
    { name: "file", contents: oldText },
    { name: "file", contents: newText },
    { context: 3 },
  );
  const hunk = file.hunks[0];
  if (hunk === undefined) return null;
  const lines: ApprovalHunkLine[] = [];
  let total = 0;
  let oldNumber = hunk.deletionStart;
  let newNumber = hunk.additionStart;
  const push = (line: ApprovalHunkLine) => {
    total += 1;
    if (lines.length < maxLines) lines.push(line);
  };
  for (const block of hunk.hunkContent) {
    if (block.type === "context") {
      for (let index = 0; index < block.lines; index += 1) {
        push({
          kind: "context",
          text: lineText(file.additionLines[block.additionLineIndex + index]),
          number: newNumber,
        });
        newNumber += 1;
        oldNumber += 1;
      }
      continue;
    }
    for (let index = 0; index < block.deletions; index += 1) {
      push({
        kind: "delete",
        text: lineText(file.deletionLines[block.deletionLineIndex + index]),
        number: oldNumber,
      });
      oldNumber += 1;
    }
    for (let index = 0; index < block.additions; index += 1) {
      push({
        kind: "add",
        text: lineText(file.additionLines[block.additionLineIndex + index]),
        number: newNumber,
      });
      newNumber += 1;
    }
  }
  return lines.length === 0 ? null : { lines, hidden: total - lines.length };
}

/**
 * What the card shows for the change it names: the first hunk of its patch when it has one,
 * otherwise of its before and after text. Null means nothing to show, or too much to compute
 * here, and the card offers the full diff instead.
 */
export function approvalPreviewFor(
  source: ApprovalPreviewSource,
  maxLines = 8,
): ApprovalHunkPreview | null {
  if (source.diffStr?.trim()) return approvalHunkPreview(source.diffStr, maxLines);
  const { oldStr, newStr } = source;
  if (oldStr == null && newStr == null) return null;
  const before = oldStr ?? "";
  const after = newStr ?? "";
  if (before.length + after.length > MAX_PREVIEW_INPUT_CHARS) return null;
  return hunkFromContents(before, after, maxLines);
}
