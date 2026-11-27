/** The shape of the list as it was last shown: a card row is "c", a one-line row is "s". */
export type SidebarOutlineRow = "card" | "slim";

const STORAGE_KEY = "one:sidebar:rows";
/** Enough rows to fill a tall sidebar; the rest of a long list is off screen at first. */
const MAX_REMEMBERED_ROWS = 30;
/** What a first visit draws: a short list of one-line rows. */
const FIRST_VISIT_ROWS: readonly SidebarOutlineRow[] = Array.from({ length: 6 }, () => "slim");

let kept: readonly SidebarOutlineRow[] | null = null;

/** The rows to draw before the real ones arrive: last visit's shape, or a short first-visit list. */
export function recalledSidebarRows(): readonly SidebarOutlineRow[] {
  if (kept !== null) return kept;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null && /^[cs]{1,30}$/.test(stored)) {
      kept = [...stored].map((letter) => (letter === "c" ? "card" : "slim"));
      return kept;
    }
  } catch {
    // Blocked storage: the outline is the first-visit one.
  }
  return FIRST_VISIT_ROWS;
}

/** Keeps the shape of the first rows of the list that is on screen, for the next visit's outline. */
export function rememberSidebarRows(rows: ReadonlyArray<SidebarOutlineRow>): void {
  if (rows.length === 0) return;
  const next = rows.slice(0, MAX_REMEMBERED_ROWS);
  const same =
    kept !== null && kept.length === next.length && kept.every((row, i) => row === next[i]);
  if (same) return;
  kept = next;
  try {
    localStorage.setItem(STORAGE_KEY, next.map((row) => (row === "card" ? "c" : "s")).join(""));
  } catch {
    // The shape is kept for this session only.
  }
}

/** Test seam: forget what this session remembered. */
export function forgetSidebarRows(): void {
  kept = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing kept in blocked storage.
  }
}

/** The outline is for a list that has not arrived, never for one that arrived empty or a search. */
export function showSidebarOutline(input: {
  readonly searching: boolean;
  readonly shellsBootstrapped: boolean;
  readonly listedRows: number;
}): boolean {
  return !input.searching && !input.shellsBootstrapped && input.listedRows === 0;
}
