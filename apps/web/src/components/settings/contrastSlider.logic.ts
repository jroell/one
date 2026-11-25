import { MAX_APPEARANCE_CONTRAST, MIN_APPEARANCE_CONTRAST } from "@t3tools/contracts/settings";

/** Contrast the interface starts at. The slider puts it in the middle of the track. */
export const CONTRAST_NEUTRAL = 100;
const STEP = 5;

/**
 * Where a contrast sits on a 0 to 100 track. The range is 50 to 200, so a straight scale would
 * put the neutral 100% a third of the way along and make it look like a low setting. Each side of
 * 100% gets half the track instead.
 */
export function contrastToPosition(contrast: number): number {
  const clamped = Math.min(MAX_APPEARANCE_CONTRAST, Math.max(MIN_APPEARANCE_CONTRAST, contrast));
  return clamped <= CONTRAST_NEUTRAL
    ? ((clamped - MIN_APPEARANCE_CONTRAST) / (CONTRAST_NEUTRAL - MIN_APPEARANCE_CONTRAST)) * 50
    : 50 + ((clamped - CONTRAST_NEUTRAL) / (MAX_APPEARANCE_CONTRAST - CONTRAST_NEUTRAL)) * 50;
}

/** The contrast under a track position, in steps of 5. */
export function positionToContrast(position: number): number {
  const clamped = Math.min(100, Math.max(0, position));
  const raw =
    clamped <= 50
      ? MIN_APPEARANCE_CONTRAST + (clamped / 50) * (CONTRAST_NEUTRAL - MIN_APPEARANCE_CONTRAST)
      : CONTRAST_NEUTRAL + ((clamped - 50) / 50) * (MAX_APPEARANCE_CONTRAST - CONTRAST_NEUTRAL);
  return Math.round(raw / STEP) * STEP;
}

/** One key press: five points of contrast up or down, or the end of the range. */
export function stepContrast(contrast: number, key: string): number | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return Math.min(MAX_APPEARANCE_CONTRAST, contrast + STEP);
    case "ArrowLeft":
    case "ArrowDown":
      return Math.max(MIN_APPEARANCE_CONTRAST, contrast - STEP);
    case "PageUp":
      return Math.min(MAX_APPEARANCE_CONTRAST, contrast + STEP * 4);
    case "PageDown":
      return Math.max(MIN_APPEARANCE_CONTRAST, contrast - STEP * 4);
    case "Home":
      return MIN_APPEARANCE_CONTRAST;
    case "End":
      return MAX_APPEARANCE_CONTRAST;
    default:
      return null;
  }
}
