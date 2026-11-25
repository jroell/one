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
});
