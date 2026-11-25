import { isCommandPaletteMounted, useCommandPaletteStore } from "../commandPaletteStore";
import { captureRunScope, type RunScope } from "./paletteRunScope";

interface PendingAction {
  readonly action: () => void;
  readonly scope: RunScope;
}

// The newest request wins: a command that needs the palette gone replaces an older one.
let pending: PendingAction | null = null;

// A palette that opens again keeps its own keys and focus, so the request lapses.
useCommandPaletteStore.subscribe((state) => {
  if (state.open) clearPending();
});

function clearPending(): void {
  pending?.scope.dispose();
  pending = null;
}

// The palette's own popup, including its closing animation, not the shortcuts sheet.
const paletteOnScreen = () => document.querySelector("[data-command-palette]") !== null;

/**
 * Runs `action` once the palette has closed and returned focus, or at once when it is not on
 * screen. Closing the palette is the caller's job (`completePaletteClose` signals the end). The
 * action is dropped if the palette opens again or unmounts, or at the first route or thread
 * change, even if the user comes back.
 */
export function runAfterPaletteClosed(action: () => void): void {
  if (!paletteOnScreen()) {
    action();
    return;
  }
  clearPending();
  pending = { action, scope: captureRunScope() };
}

export function completePaletteClose(): void {
  const request = pending;
  pending = null;
  if (!request) return;
  const valid = request.scope.isValid();
  request.scope.dispose();
  if (valid && isCommandPaletteMounted()) request.action();
}
