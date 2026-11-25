import type {
  KeybindingCommand,
  KeybindingShortcut,
  ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { msg } from "gt-react";

import { toastManager } from "../components/ui/toast";
import { m } from "../i18n/messages";
import { resolveShortcutCommand, type ShortcutMatchContext } from "../keybindings";
import { isMacPlatform } from "../lib/utils";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { primaryServerKeybindingsAtom } from "../state/server";
import { whenPaletteClosed } from "./paletteClosed";

/** What the keys will find once the palette has closed and focus is back in the page. */
const IDLE_CONTEXT: Partial<ShortcutMatchContext> = {
  terminalFocus: false,
  previewFocus: false,
  editableFocus: false,
  modelPickerOpen: false,
};

function eventForShortcut(shortcut: KeybindingShortcut, platform: string): KeyboardEvent {
  const isMac = isMacPlatform(platform);
  return new KeyboardEvent("keydown", {
    key: shortcut.key,
    metaKey: shortcut.metaKey || (shortcut.modKey && isMac),
    ctrlKey: shortcut.ctrlKey || (shortcut.modKey && !isMac),
    shiftKey: shortcut.shiftKey,
    altKey: shortcut.altKey,
    bubbles: true,
    cancelable: true,
  });
}

/**
 * The key that runs `command` right now: the newest binding of the command that is not
 * shadowed by another command and whose `when` clause holds. Null when the command is
 * unbound, or bound only for a focus the palette cannot restore, such as the terminal.
 */
function runnableShortcut(
  command: KeybindingCommand,
  keybindings: ResolvedKeybindingsConfig,
  platform: string,
): KeybindingShortcut | null {
  for (let index = keybindings.length - 1; index >= 0; index -= 1) {
    const binding = keybindings[index];
    if (!binding || binding.command !== command) continue;
    const resolved = resolveShortcutCommand(
      eventForShortcut(binding.shortcut, platform),
      keybindings,
      { platform, context: IDLE_CONTEXT },
    );
    if (resolved === command) return binding.shortcut;
  }
  return null;
}

export function isCommandRunnable(
  command: KeybindingCommand,
  keybindings: ResolvedKeybindingsConfig,
  platform = navigator.platform,
): boolean {
  return runnableShortcut(command, keybindings, platform) !== null;
}

/**
 * Runs a command through the same key handlers its shortcut reaches, so the palette
 * adds no second copy of what a shortcut does. Waits for the palette to finish closing,
 * because the handlers ignore keys while it is on screen.
 */
export async function runKeybindingCommand(
  command: KeybindingCommand,
  title: string,
): Promise<void> {
  const keybindings = appAtomRegistry.get(primaryServerKeybindingsAtom);
  const shortcut = runnableShortcut(command, keybindings, navigator.platform);
  const reportUnavailable = () =>
    toastManager.add({
      type: "info",
      title: m(msg("{command} is not available here", { command: title })),
    });
  if (shortcut === null) {
    reportUnavailable();
    return;
  }
  if (!(await whenPaletteClosed())) return;
  const target = document.activeElement ?? document.body;
  // A handler that ran the command consumes the key.
  const unhandled = target.dispatchEvent(eventForShortcut(shortcut, navigator.platform));
  if (unhandled) reportUnavailable();
}
