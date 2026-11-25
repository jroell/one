/** The attribute that marks the keyboard shortcuts sheet's popup. */
export const SHORTCUTS_SHEET_ATTRIBUTE = "data-shortcuts-sheet";

/** True while the sheet is on screen, including its closing animation. */
export function isShortcutsSheetOnScreen(): boolean {
  return (
    typeof document !== "undefined" &&
    document.querySelector(`[${SHORTCUTS_SHEET_ATTRIBUTE}]`) !== null
  );
}
