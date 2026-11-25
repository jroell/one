import {
  MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
  THREAD_JUMP_KEYBINDING_COMMANDS,
} from "@t3tools/contracts";
import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { describe, expect, it } from "vite-plus/test";

import { buildShortcutSections } from "./ShortcutsDialog.logic";

const build = (
  config: Parameters<typeof compileResolvedKeybindingsConfig>[0],
  options: {
    readonly query?: string;
    readonly platform?: string;
    readonly sendShortcut?: "enter" | "mod-enter-multiline" | "mod-enter";
  } = {},
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

  it("lists a numbered family with a remapped or unassigned member as individual rows", () => {
    const jumps = THREAD_JUMP_KEYBINDING_COMMANDS.map((command, index) => ({
      command,
      key: `mod+${index + 1}`,
    }));
    const remapped = jumps.map((jump) =>
      jump.command === "thread.jump.5" ? { ...jump, key: "mod+alt+x" } : jump,
    );
    const gap = jumps.map((jump) =>
      jump.command === "thread.jump.5" ? { ...jump, when: "false" } : jump,
    );

    for (const config of [remapped, gap]) {
      const rows = build(config).flatMap((section) =>
        section.rows.filter((row) => /jump/i.test(row.label)),
      );
      expect(rows.some((row) => row.keysJoiner === "to")).toBe(false);
      expect(rows.map((row) => row.command).toSorted()).toEqual(
        THREAD_JUMP_KEYBINDING_COMMANDS.filter(
          (command) => config !== gap || command !== "thread.jump.5",
        ).toSorted(),
      );
    }
    expect(
      build(remapped, { query: "ctrl alt x" }).flatMap((section) =>
        section.rows.map((row) => row.command),
      ),
    ).toEqual(["thread.jump.5"]);
  });

  it("finds a numbered family by any of its keys while showing only the first and last", () => {
    const sections = build(
      THREAD_JUMP_KEYBINDING_COMMANDS.map((command, index) => ({
        command,
        key: `mod+${index + 1}`,
      })),
      { query: "ctrl 5" },
    );

    expect(sections.flatMap((section) => section.rows.map((row) => row.keys))).toEqual([
      [
        ["Ctrl", "1"],
        ["Ctrl", "9"],
      ],
    ]);
  });

  it("lists the chord the send shortcut moves a command to, not the one it left", () => {
    const config = [
      {
        command: "composer.sendAlternate" as const,
        key: "mod+enter",
        when: "composerFocus && turnRunning",
      },
      // Takes Mod+Enter in the same contexts, so the sheet hid the command with the default send key.
      { command: "composer.mode" as const, key: "mod+enter", when: "composerFocus" },
    ];
    const keysOf = (sendShortcut: "enter" | "mod-enter" | "mod-enter-multiline") =>
      build(config, { sendShortcut })
        .flatMap((section) => section.rows)
        .filter((row) => row.command === "composer.sendAlternate")
        .map((row) => row.keys);

    expect(keysOf("enter")).toEqual([]);
    expect(keysOf("mod-enter")).toEqual([[["Ctrl", "Shift", "Enter"]]]);
    expect(keysOf("mod-enter-multiline")).toEqual([[["Ctrl", "Shift", "Enter"]]]);
  });

  it("shows a key again once comparing it would exceed the work budget", () => {
    // 256 rules on one key, each covered by the next rule of the other command.
    const config = compileResolvedKeybindingsConfig(
      Array.from({ length: 256 }, (_, index) => ({
        command: index % 2 === 0 ? ("diff.toggle" as const) : ("composer.mode" as const),
        key: "mod+d",
        when: "composerFocus && editableFocus && previewFocus && terminalFocus",
      })),
    );

    const listed = buildShortcutSections(config, { platform: "Linux x86_64" }).flatMap((section) =>
      section.rows.map((row) => row.command),
    );

    expect(listed.toSorted()).toEqual(["composer.mode", "diff.toggle"]);
  });

  it("builds the rows once for a config and filters them on each keystroke", () => {
    const config = compileResolvedKeybindingsConfig([
      { command: "diff.toggle", key: "mod+d" },
      { command: "sidebar.toggle", key: "mod+b" },
    ]);
    const rowsOf = (query: string) =>
      buildShortcutSections(config, { platform: "Linux x86_64", query }).flatMap(
        (section) => section.rows,
      );

    const all = rowsOf("");

    expect(rowsOf("diff")[0]).toBe(all.find((row) => row.command === "diff.toggle"));
    expect(rowsOf("d")[0]).toBe(all.find((row) => row.command === "diff.toggle"));
  });
});
