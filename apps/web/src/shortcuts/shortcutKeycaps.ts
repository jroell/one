import type { KeybindingShortcut } from "@t3tools/contracts";

import { formatShortcutKeyLabel } from "../keybindings";
import { isMacPlatform } from "../lib/utils";

/**
 * One cap per key, in the order `formatShortcutLabel` prints them, so a keycap row and
 * a tooltip hint show the same glyphs.
 */
export function shortcutKeycaps(
  shortcut: KeybindingShortcut,
  platform = navigator.platform,
): ReadonlyArray<string> {
  const isMac = isMacPlatform(platform);
  const meta = shortcut.metaKey || (shortcut.modKey && isMac);
  const ctrl = shortcut.ctrlKey || (shortcut.modKey && !isMac);
  const key = formatShortcutKeyLabel(shortcut.key);
  return isMac
    ? [
        ...(ctrl ? ["⌃"] : []),
        ...(shortcut.altKey ? ["⌥"] : []),
        ...(shortcut.shiftKey ? ["⇧"] : []),
        ...(meta ? ["⌘"] : []),
        key,
      ]
    : [
        ...(ctrl ? ["Ctrl"] : []),
        ...(shortcut.altKey ? ["Alt"] : []),
        ...(shortcut.shiftKey ? ["Shift"] : []),
        ...(meta ? ["Meta"] : []),
        key,
      ];
}
