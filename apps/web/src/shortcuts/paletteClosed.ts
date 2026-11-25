import { isCommandPaletteOpen } from "../commandPaletteBus";
import { useCommandPaletteStore } from "../commandPaletteStore";

/**
 * Resolves true once the palette has finished closing, false if it opened again first.
 * Whatever runs next takes focus and key handling from a palette that is gone, not from
 * one still fading out.
 */
export function whenPaletteClosed(): Promise<boolean> {
  if (!isCommandPaletteOpen()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (useCommandPaletteStore.getState().open) {
        observer.disconnect();
        resolve(false);
      } else if (!isCommandPaletteOpen()) {
        observer.disconnect();
        resolve(true);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}
