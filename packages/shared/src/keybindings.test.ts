import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_KEYBINDINGS, parseKeybindingShortcut } from "./keybindings.ts";

// Chords the system, a browser or an input method takes before the page sees them, written with
// `mod` (Command on macOS, Control elsewhere). A default on one of these never reaches the app.
const RESERVED_CHORDS = [
  // macOS
  "mod+alt+d", // show or hide the Dock
  "mod+alt+h", // hide others
  "mod+alt+m", // minimize all
  "mod+alt+w", // close all
  "mod+alt+escape", // force quit
  "mod+shift+q", // log out
  "mod+shift+3",
  "mod+shift+4",
  "mod+shift+5",
  "mod+q",
  "mod+h",
  "mod+m",
  "mod+space",
  "mod+tab",
  // Windows and Linux desktops
  "mod+alt+delete",
  "mod+alt+t", // terminal
  "mod+alt+l", // lock
  "mod+alt+arrowleft",
  "mod+alt+arrowright",
  "mod+alt+arrowup",
  "mod+alt+arrowdown",
  // Browsers, which a page cannot cancel
  "mod+t",
  "mod+n",
  "mod+w",
  "mod+shift+t",
  "mod+shift+n",
  "mod+shift+w",
  // Developer tools and reload
  "mod+shift+i",
  "mod+shift+r",
];

const sameChord = (left: string, right: string) => {
  const a = parseKeybindingShortcut(left);
  const b = parseKeybindingShortcut(right);
  return a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b);
};

describe("approval keybindings", () => {
  const commands = ["approval.approve", "approval.decline"] as const;

  it("binds Approve and Decline by default, on chords nothing else uses in any context", () => {
    for (const command of commands) {
      const rules = DEFAULT_KEYBINDINGS.filter((rule) => rule.command === command);
      expect(rules, command).toHaveLength(1);
      const shared = DEFAULT_KEYBINDINGS.filter(
        (rule) => sameChord(rule.key, rules[0]!.key) && rule.command !== command,
      );
      expect(shared, `${command} shares ${rules[0]!.key}`).toEqual([]);
    }
  });

  it("keeps Approve and Decline off chords the system, a browser or an input method takes", () => {
    for (const command of commands) {
      const key = DEFAULT_KEYBINDINGS.find((rule) => rule.command === command)!.key;
      const taken = RESERVED_CHORDS.filter((reserved) => sameChord(reserved, key));
      expect(taken, `${command} is bound to ${key}`).toEqual([]);
      // AltGr is Control plus Alt on Windows, so Control+Alt+letter types a character on many layouts.
      expect(/\balt\+[a-z]$/.test(key), `${command} on ${key} uses alt and a letter`).toBe(false);
    }
  });

  it("fails on the reserved chords it lists", () => {
    // The old Decline default was the macOS Dock shortcut: the list must name it.
    expect(RESERVED_CHORDS.some((reserved) => sameChord(reserved, "mod+alt+d"))).toBe(true);
  });
});
