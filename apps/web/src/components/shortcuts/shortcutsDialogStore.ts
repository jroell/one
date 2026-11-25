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

/**
 * Whether the element is a dialog the user can see or is watching leave. A mobile sidebar or a
 * retained panel stays mounted while closed, with `hidden`, no layout and Base UI's closed
 * state; none of them owns the keyboard.
 */
function isKeyboardOwnerOnScreen(element: HTMLElement): boolean {
  if (element.hidden || element.closest("[hidden]") !== null) return false;
  const closedAndGone =
    element.hasAttribute("data-closed") && !element.hasAttribute("data-ending-style");
  if (closedAndGone) return false;
  return typeof element.checkVisibility === "function"
    ? element.checkVisibility({ visibilityProperty: true })
    : element.getClientRects().length > 0;
}

function isOtherKeyboardOwnerOpen(): boolean {
  return [...document.querySelectorAll<HTMLElement>(OTHER_KEYBOARD_OWNER_SELECTOR)].some(
    isKeyboardOwnerOnScreen,
  );
}

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
    if (!isOtherKeyboardOwnerOpen()) setShortcutsDialogOpen(true);
  });
}
