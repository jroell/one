import type { KeybindingCommand } from "@t3tools/contracts";

import { shortcutLabelForCommand } from "../keybindings";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { primaryServerKeybindingsAtom } from "../state/server";

/**
 * The live key hint for a command, read when called. Menus built on click and
 * tooltips use it; components that already subscribe to the keybindings atom pass
 * the config to `shortcutLabelForCommand` instead.
 */
export function readShortcutLabel(command: KeybindingCommand): string | null {
  return shortcutLabelForCommand(appAtomRegistry.get(primaryServerKeybindingsAtom), command);
}
