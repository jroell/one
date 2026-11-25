import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@t3tools/contracts";

import { isCommandRunnable } from "../../shortcuts/runCommand";

/** Commands whose handlers live in the open chat, so they do nothing on other pages. */
const CHAT_COMMAND_PREFIXES = new Set([
  "thread",
  "composer",
  "terminal",
  "rightPanel",
  "threadPanel",
  "diff",
  "preview",
  "modelPicker",
  "editor",
  "pullRequest",
  "script",
]);

function needsOpenChat(command: KeybindingCommand): boolean {
  return command === "chat.find" || CHAT_COMMAND_PREFIXES.has(String(command).split(".")[0] ?? "");
}

/** The palette's own overlays and the usage page's keys have no business running from a row. */
const NOT_RUNNABLE_FROM_PALETTE = new Set([
  "commandPalette",
  "filePicker",
  "projectSearch",
  "usage",
]);

/**
 * Whether Enter on the command's row can run it: it has a key that resolves once the
 * palette is closed, and the page it works on is open.
 */
export function canRunFromPalette(
  command: KeybindingCommand,
  keybindings: ResolvedKeybindingsConfig,
  hasOpenChat: boolean,
): boolean {
  if (NOT_RUNNABLE_FROM_PALETTE.has(String(command).split(".")[0] ?? "")) return false;
  if (needsOpenChat(command) && !hasOpenChat) return false;
  return isCommandRunnable(command, keybindings);
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
