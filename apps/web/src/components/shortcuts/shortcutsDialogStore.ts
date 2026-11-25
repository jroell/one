import { create } from "zustand";

import { whenPaletteClosed } from "../../shortcuts/paletteClosed";

export const useShortcutsDialogStore = create<{ readonly open: boolean }>(() => ({ open: false }));

export function setShortcutsDialogOpen(open: boolean): void {
  useShortcutsDialogStore.setState({ open });
}

/** Opens or closes the sheet; one opened from the palette waits until the palette is gone. */
export async function toggleShortcutsDialog(): Promise<void> {
  if (useShortcutsDialogStore.getState().open) {
    setShortcutsDialogOpen(false);
    return;
  }
  if (await whenPaletteClosed()) setShortcutsDialogOpen(true);
}
