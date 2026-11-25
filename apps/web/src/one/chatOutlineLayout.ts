/** The turn the outline marks: the one under the line a quarter of the way down the viewport. */
const READING_LINE_FRACTION = 0.25;

/**
 * The turn being read. `topAt` gives a turn's row top in the timeline's scroll coordinates and is
 * read only along a binary search. `atEnd` is the caller's physical end check (the scroll node's
 * own offsets), which also holds for a thread that fits: either marks the last turn.
 */
export function resolveOutlineCurrentIndex(input: {
  readonly count: number;
  readonly topAt: (index: number) => number;
  readonly scroll: number;
  readonly viewportHeight: number;
  readonly atEnd: boolean;
}): number | null {
  const { count, topAt, scroll, viewportHeight, atEnd } = input;
  if (count === 0) return null;
  if (atEnd) return count - 1;
  const line = scroll + viewportHeight * READING_LINE_FRACTION;
  let low = 0;
  let high = count - 1;
  let containing = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (topAt(middle) <= line) {
      containing = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return containing === -1 ? 0 : containing;
}

/** The outline needs this much width: the reading column, plus a gutter of 12rem and its margins. */
const OUTLINE_MIN_WIDTH_REM = 72.5;
/** Room for its insets (16.25rem), its title and three rows. */
const OUTLINE_MIN_HEIGHT_REM = 24;

export function chatOutlineFits(size: {
  readonly width: number;
  readonly height: number;
  readonly rem: number;
}): boolean {
  return (
    size.width >= OUTLINE_MIN_WIDTH_REM * size.rem &&
    size.height >= OUTLINE_MIN_HEIGHT_REM * size.rem
  );
}
