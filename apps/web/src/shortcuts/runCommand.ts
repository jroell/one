import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import type { KeybindingCommand } from "@t3tools/contracts";
import { msg } from "gt-react";

import { toastManager } from "../components/ui/toast";
import { m } from "../i18n/messages";
import { runAfterPaletteClosed } from "./afterPaletteClose";
import { runRegisteredCommand } from "./commandRegistry";
import { readPaletteRunContext } from "./paletteRunScope";

/**
 * Runs a command from a palette row by id, through the function its scope registered for the
 * key, once the palette has closed. Nothing is dispatched as a key. The command gets the focus
 * the palette opened from, and is dropped at the first route or thread change while the popup left.
 */
export async function runCommandFromPalette(
  command: KeybindingCommand,
  title: string,
): Promise<void> {
  const context = readPaletteRunContext();
  runAfterPaletteClosed(() => {
    try {
      if (runRegisteredCommand(command, context)) return;
    } catch (error) {
      toastManager.add({
        type: "error",
        title: m(msg("Unable to run command")),
        description: thrownErrorMessage(error, m) ?? m(msg("An unexpected error occurred.")),
      });
      return;
    }
    toastManager.add({
      type: "info",
      title: m(msg("{command} is not available here", { command: title })),
    });
  });
}
