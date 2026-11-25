import type { KeybindingCommand } from "@t3tools/contracts";

import { isCommandAvailable } from "../../shortcuts/commandRegistry";

/** The palette's own overlays and the usage page's keys have no business running from a row. */
const NOT_RUNNABLE_FROM_PALETTE = new Set([
  "commandPalette",
  "filePicker",
  "projectSearch",
  "usage",
]);

/** Whether Enter on the command's row can run it: a scope registered it and it can run now. */
export function canRunFromPalette(command: KeybindingCommand): boolean {
  if (NOT_RUNNABLE_FROM_PALETTE.has(String(command).split(".")[0] ?? "")) return false;
  return isCommandAvailable(command);
}

const KEYBINDING_SEARCH_PREFIX = "keybinding-";

/** The command behind a settings search row that jumps to a keybinding, if it is one. */
export function commandOfKeybindingSearchRow(
  id: string,
  commands: ReadonlyArray<KeybindingCommand>,
): KeybindingCommand | null {
  if (!id.startsWith(KEYBINDING_SEARCH_PREFIX)) return null;
  const command = id.slice(KEYBINDING_SEARCH_PREFIX.length);
  return commands.find((candidate) => candidate === command) ?? null;
}
