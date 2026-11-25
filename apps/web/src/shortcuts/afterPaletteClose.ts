import { isCommandPaletteMounted, useCommandPaletteStore } from "../commandPaletteStore";

interface PendingAction {
  readonly action: () => void;
  readonly stillValid: () => boolean;
}

// The newest request wins: a command that needs the palette gone replaces an older one.
let pending: PendingAction | null = null;

// A palette that opens again keeps its own keys and focus, so the request lapses.
useCommandPaletteStore.subscribe((state) => {
  if (state.open) pending = null;
});

// The palette's own popup, including its closing animation, not the shortcuts sheet.
const paletteOnScreen = () => document.querySelector("[data-command-palette]") !== null;

/**
 * Runs `action` once the palette has finished closing and returned focus, or at once when it is
 * not on screen. Closing the palette is the caller's job. The palette calls
 * `completePaletteClose` from its dialog's close-complete callback. The action is dropped when
 * the palette opens again, when it unmounts, or when `stillValid` turns false in between.
 */
export function runAfterPaletteClosed(
  action: () => void,
  options: { readonly stillValid?: () => boolean } = {},
): void {
  if (!paletteOnScreen()) {
    action();
    return;
  }
  pending = { action, stillValid: options.stillValid ?? (() => true) };
}

export function completePaletteClose(): void {
  const request = pending;
  pending = null;
  if (request && isCommandPaletteMounted() && request.stillValid()) request.action();
}
