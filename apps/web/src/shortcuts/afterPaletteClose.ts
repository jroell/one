import { useCommandPaletteStore } from "../commandPaletteStore";

// The newest request wins: a command that needs the palette gone replaces an older one.
let pending: (() => void) | null = null;

// A palette that opens again keeps its own keys and focus, so the request lapses.
useCommandPaletteStore.subscribe((state) => {
  if (state.open) pending = null;
});

// The palette's own popup, including its closing animation, not the shortcuts sheet.
const paletteOnScreen = () => document.querySelector("[data-command-palette]") !== null;

/**
 * Runs `action` once the palette has finished closing and returned focus, or at once when it is
 * not on screen. Closing the palette is the caller's job. The palette calls
 * `completePaletteClose` from its dialog's close-complete callback.
 */
export function runAfterPaletteClosed(action: () => void): void {
  if (!paletteOnScreen()) {
    action();
    return;
  }
  pending = action;
}

export function completePaletteClose(): void {
  const action = pending;
  pending = null;
  action?.();
}
