import { create } from "zustand";

import { runAfterPaletteClosed } from "../../shortcuts/afterPaletteClose";
import { SHORTCUTS_SHEET_ATTRIBUTE } from "../../shortcuts/shortcutsSheet";

export const useShortcutsDialogStore = create<{ readonly open: boolean }>(() => ({ open: false }));

// Another dialog keeps the keyboard; Settings is a page, so the sheet may open over it.
const OTHER_KEYBOARD_OWNER_SELECTOR = [
  `[role="dialog"]:not([data-app-modal]):not([data-command-palette]):not([${SHORTCUTS_SHEET_ATTRIBUTE}])`,
  '[role="alertdialog"]',
  `[aria-modal="true"]:not([data-app-modal]):not([data-command-palette]):not([${SHORTCUTS_SHEET_ATTRIBUTE}])`,
].join(", ");

export function setShortcutsDialogOpen(open: boolean): void {
  useShortcutsDialogStore.setState({ open });
}

/** Opens or closes the sheet; one opened from the palette waits until the palette is gone. */
export function toggleShortcutsDialog(): void {
  if (useShortcutsDialogStore.getState().open) {
    setShortcutsDialogOpen(false);
    return;
  }
  runAfterPaletteClosed(() => {
    if (document.querySelector(OTHER_KEYBOARD_OWNER_SELECTOR) === null)
      setShortcutsDialogOpen(true);
  });
}
