import {
  MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
  THREAD_JUMP_KEYBINDING_COMMANDS,
} from "@t3tools/contracts";
import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { describe, expect, it } from "vite-plus/test";

import { buildShortcutSections } from "./ShortcutsDialog.logic";

const build = (
  config: Parameters<typeof compileResolvedKeybindingsConfig>[0],
  options: { readonly query?: string; readonly platform?: string } = {},
) =>
  buildShortcutSections(compileResolvedKeybindingsConfig(config), {
    platform: "Linux x86_64",
    ...options,
  });

describe("buildShortcutSections", () => {
  it("lists a custom key under the heading the palette uses for its command", () => {
    const sections = build([
      { command: "terminal.toggle", key: "mod+alt+9" },
      { command: "commandPalette.toggle", key: "mod+k", when: "!terminalFocus" },
    ]);

    expect(
      sections.map((section) => [section.title, section.rows.map((row) => [row.label, row.keys])]),
    ).toEqual([
      ["View", [["Terminal: Toggle", [["Ctrl", "Alt", "9"]]]]],
      ["Navigate", [["Command Palette: Toggle", [["Ctrl", "K"]]]]],
    ]);
  });

  it("shows alternate keys on one row and drops unassigned and other-platform keys", () => {
    const sections = build([
      { command: "chat.new", key: "mod+n", when: "!terminalFocus" },
      { command: "chat.new", key: "mod+shift+o", when: "!terminalFocus" },
      { command: "workspace.focusNext", key: "f6", when: "false" },
      { command: "terminal.next", key: "ctrl+alt+]", when: "terminalFocus && !isMac" },
      { command: "terminal.next", key: "cmd+shift+]", when: "terminalFocus && isMac" },
    ]);

    expect(
      sections.map((section) => [
        section.title,
        section.rows.map((row) => [row.label, row.qualifier, row.keys]),
      ]),
    ).toEqual([
      [
        "Thread",
        [
          [
            "Chat: New",
            null,
            [
              ["Ctrl", "N"],
              ["Ctrl", "Shift", "O"],
            ],
          ],
        ],
      ],
      ["View", [["Terminal: Next", "in the terminal", [["Ctrl", "Alt", "]"]]]]],
    ]);
  });

  it("filters by label, command id or key", () => {
    const config = [
      { command: "diff.toggle" as const, key: "mod+d" },
      { command: "sidebar.toggle" as const, key: "mod+b" },
    ];

    expect(build(config, { query: "diff" }).flatMap((s) => s.rows.map((r) => r.command))).toEqual([
      "diff.toggle",
    ]);
    expect(build(config, { query: "ctrl b" }).flatMap((s) => s.rows.map((r) => r.command))).toEqual(
      ["sidebar.toggle"],
    );
    expect(build(config, { query: "nothing like this" })).toEqual([]);
  });

  it("leaves out a key that a later command always takes in the same contexts", () => {
    const sections = build([
      { command: "diff.toggle", key: "mod+d", when: "!terminalFocus" },
      { command: "composer.mode", key: "mod+d", when: "!terminalFocus" },
      { command: "sidebar.toggle", key: "mod+b", when: "editableFocus" },
      { command: "workspace.focusNext", key: "mod+b", when: "!editableFocus" },
      { command: "terminal.toggle", key: "mod+j" },
      { command: "composer.stash", key: "mod+j", when: "terminalFocus" },
      { command: "thread.pin", key: "mod+j", when: "!terminalFocus" },
    ]);

    expect(
      sections.flatMap((section) => section.rows.map((row) => [row.command, row.keys])),
    ).toEqual(
      expect.arrayContaining([
        ["composer.mode", [["Ctrl", "D"]]],
        ["sidebar.toggle", [["Ctrl", "B"]]],
        ["workspace.focusNext", [["Ctrl", "B"]]],
      ]),
    );
    const listed = sections.flatMap((section) => section.rows.map((row) => row.command));
    expect(listed).not.toContain("diff.toggle");
    expect(listed).not.toContain("terminal.toggle");
  });

  it("lists each numbered jump family as one row from its first key to its last", () => {
    const sections = build([
      ...THREAD_JUMP_KEYBINDING_COMMANDS.map((command, index) => ({
        command,
        key: `mod+${index + 1}`,
        when: "terminalFocus",
      })),
      ...MODEL_PICKER_JUMP_KEYBINDING_COMMANDS.map((command, index) => ({
        command,
        key: `mod+${index + 1}`,
        when: "modelPickerOpen",
      })),
      { command: "thread.previous" as const, key: "mod+[" },
    ]);

    const jumpRows = sections
      .flatMap((section) => section.rows)
      .filter((row) => /jump/i.test(row.label));
    expect(jumpRows.map((row) => [row.label, row.qualifier, row.keys, row.keysJoiner])).toEqual([
      [
        "Model picker: jump to model 1 to 9",
        "with the model picker open",
        [
          ["Ctrl", "1"],
          ["Ctrl", "9"],
        ],
        "to",
      ],
      [
        "Thread: jump to thread 1 to 9",
        "in the terminal",
        [
          ["Ctrl", "1"],
          ["Ctrl", "9"],
        ],
        "to",
      ],
    ]);
  });

  it("keeps a lone numbered jump command as its own row", () => {
    const sections = build([{ command: "thread.jump.3", key: "mod+3" }]);

    expect(sections.flatMap((section) => section.rows.map((row) => row.label))).toEqual([
      "Thread: Jump: 3",
    ]);
  });
});
