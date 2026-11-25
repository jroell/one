import { useCommandPaletteStore } from "../../commandPaletteStore";

let activatedThisOpen = false;

// Each time the palette opens it accepts one activation that closes it again.
useCommandPaletteStore.subscribe((state, previous) => {
  if (state.open && !previous.open) activatedThisOpen = false;
});

/**
 * Whether a row that closes the palette may run now. Enter or a click during the close
 * transition arrives while the row is still on screen, and would run it a second time.
 */
export function claimPaletteActivation(): boolean {
  if (activatedThisOpen) return false;
  activatedThisOpen = true;
  return true;
}
