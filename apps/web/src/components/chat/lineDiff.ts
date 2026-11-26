/**
 * A real line diff for the approval card, with a hard budget. It is Myers' O(ND) algorithm over
 * the lines the two texts do not share at their ends. When either text is too long, or the two
 * differ by more edits than the budget, it gives up and returns null, and the card shows labelled
 * excerpts instead of a diff. It never returns an approximation of a diff.
 */

/** Lines per side, after the shared start and end are trimmed. */
const MAX_DIFF_LINES = 4_000;
/** Edits (insertions plus deletions) the search will follow before it gives up. */
const MAX_DIFF_EDITS = 500;

export interface DiffOp {
  readonly kind: "equal" | "delete" | "insert";
  /** Index in the old lines for `equal` and `delete`. */
  readonly oldIndex: number;
  /** Index in the new lines for `equal` and `insert`. */
  readonly newIndex: number;
}

/** Lines with their line ending kept, so a change to the final newline is a change to a line. */
export function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/** The edit script turning `before` into `after`, or null when over budget. */
export function diffLines(
  before: ReadonlyArray<string>,
  after: ReadonlyArray<string>,
  limits: { readonly maxLines?: number; readonly maxEdits?: number } = {},
): DiffOp[] | null {
  const maxLines = limits.maxLines ?? MAX_DIFF_LINES;
  const maxEdits = limits.maxEdits ?? MAX_DIFF_EDITS;
  let start = 0;
  const shortest = Math.min(before.length, after.length);
  while (start < shortest && before[start] === after[start]) start += 1;
  let end = 0;
  while (
    end < shortest - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end += 1;
  }
  const oldMiddle = before.slice(start, before.length - end);
  const newMiddle = after.slice(start, after.length - end);
  if (oldMiddle.length > maxLines || newMiddle.length > maxLines) return null;

  const ids = new Map<string, number>();
  const intern = (line: string) => {
    let id = ids.get(line);
    if (id === undefined) {
      id = ids.size;
      ids.set(line, id);
    }
    return id;
  };
  const a = oldMiddle.map(intern);
  const b = newMiddle.map(intern);
  const script = myers(a, b, maxEdits);
  if (script === null) return null;

  const ops: DiffOp[] = [];
  for (let index = 0; index < start; index += 1) {
    ops.push({ kind: "equal", oldIndex: index, newIndex: index });
  }
  for (const op of script) {
    ops.push({
      kind: op.kind,
      oldIndex: op.kind === "insert" ? 0 : op.oldIndex + start,
      newIndex: op.kind === "delete" ? 0 : op.newIndex + start,
    });
  }
  for (let index = 0; index < end; index += 1) {
    ops.push({
      kind: "equal",
      oldIndex: before.length - end + index,
      newIndex: after.length - end + index,
    });
  }
  return ops;
}

function myers(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
  maxEdits: number,
): DiffOp[] | null {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  const max = Math.min(n + m, maxEdits);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) {
        x = v[offset + k + 1]!;
      } else {
        x = v[offset + k - 1]! + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, offset, n, m, d);
    }
  }
  return null;
}

function backtrack(
  trace: ReadonlyArray<Int32Array>,
  offset: number,
  n: number,
  m: number,
  last: number,
): DiffOp[] {
  const reversed: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = last; d >= 0; d -= 1) {
    const v = trace[d]!;
    const k = x - y;
    const previousK =
      k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? k + 1 : k - 1;
    const previousX = v[offset + previousK]!;
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
      reversed.push({ kind: "equal", oldIndex: x, newIndex: y });
    }
    if (d > 0) {
      if (x === previousX) {
        y -= 1;
        reversed.push({ kind: "insert", oldIndex: 0, newIndex: y });
      } else {
        x -= 1;
        reversed.push({ kind: "delete", oldIndex: x, newIndex: 0 });
      }
    }
    x = previousX;
    y = previousY;
  }
  return reversed.toReversed();
}
