import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { expect, it } from "vite-plus/test";

import { buildShortcutSections } from "./ShortcutsDialog.logic";

it("lists the default approval shortcuts under an Approval heading as Approve and Decline", () => {
  const section = buildShortcutSections(DEFAULT_RESOLVED_KEYBINDINGS, {
    platform: "Linux x86_64",
  }).find((candidate) => candidate.title === "Approval");
  expect(section?.rows.map((row) => [row.label, row.keys])).toEqual([
    ["Approve", [["Ctrl", "Alt", "Y"]]],
    ["Decline", [["Ctrl", "Alt", "D"]]],
  ]);
});
