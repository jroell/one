import { PIERRE_TREE_UNSAFE_CSS } from "../../pierre-tree-theme";

/**
 * Tree rows inside the file tree's shadow root. Hover and press answer on the shared ladder,
 * the selected row carries a brand tick and a rim, and keyboard focus draws a ring.
 */
const FILE_TREE_CHROME_CSS = `
  button[data-type='item'][aria-selected='true'] {
    box-shadow:
      inset 2px 0 0 var(--one-brand, currentColor),
      inset 0 0 0 1px color-mix(in srgb, currentColor 9%, transparent);
  }
  button[data-type='item']:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--ring, currentColor) 70%, transparent);
  }
  @media (prefers-reduced-motion: no-preference) {
    button[data-type='item'] {
      transition:
        background-color var(--one-hover-ms, 140ms) var(--one-ease-hover, ease-out),
        box-shadow var(--one-hover-ms, 140ms) var(--one-ease-hover, ease-out),
        color var(--one-hover-ms, 140ms) var(--one-ease-hover, ease-out);
    }
    button[data-type='item']:active {
      transition-duration: var(--one-press-ms, 90ms);
      background-color: color-mix(in srgb, currentColor 11%, transparent);
    }
  }
`;

export const FILE_TREE_UNSAFE_CSS = `${PIERRE_TREE_UNSAFE_CSS}\n${FILE_TREE_CHROME_CSS}`;

/** The row height on touch. Pierre sizes its scroll model from `itemHeight`, so a CSS height would drift from it. */
const TOUCH_FILE_TREE_ITEM_HEIGHT = 44;

export function fileTreeItemHeightOption(
  coarsePointer = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches,
): { itemHeight?: number } {
  return coarsePointer ? { itemHeight: TOUCH_FILE_TREE_ITEM_HEIGHT } : {};
}
