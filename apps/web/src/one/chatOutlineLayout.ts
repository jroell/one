/** The turn the outline marks: the one under the line a quarter of the way down the viewport. */
const READING_LINE_FRACTION = 0.25;

/**
 * The turn being read. `tops` are the turns' row tops in the timeline's scroll coordinates.
 * A thread that fits, or one scrolled to its end, marks its last turn.
 */
export function resolveOutlineCurrentIndex(input: {
  readonly tops: ReadonlyArray<number>;
  readonly scroll: number;
  readonly viewportHeight: number;
  readonly scrollHeight: number;
}): number | null {
  const { tops, scroll, viewportHeight, scrollHeight } = input;
  if (tops.length === 0) return null;
  const last = tops.length - 1;
  if (scrollHeight - viewportHeight <= 1 || scroll + viewportHeight >= scrollHeight - 1) {
    return last;
  }
  const line = scroll + viewportHeight * READING_LINE_FRACTION;
  const containing = tops.findLastIndex((top) => top <= line);
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
