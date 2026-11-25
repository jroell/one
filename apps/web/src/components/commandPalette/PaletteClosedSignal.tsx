import { useEffect } from "react";

import { completePaletteClose } from "../../shortcuts/afterPaletteClose";

/**
 * Rendered inside the palette's popup. When the popup leaves the page it runs the command that
 * waited for that, after the dialog has returned focus: Base UI does so in a microtask queued
 * during the same unmount, so a command that opens or focuses something is not undone by it.
 */
export function PaletteClosedSignal() {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the command waiting on the palette that its popup has been removed and focus is back
  useEffect(() => () => queueMicrotask(() => queueMicrotask(completePaletteClose)), []);
  return null;
}
