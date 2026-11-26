import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { expect, it } from "vite-plus/test";

import { buildShortcutSections } from "./ShortcutsDialog.logic";

it("lists the default approval shortcuts under an Approval heading as Approve and Decline", () => {
  const section = buildShortcutSections(DEFAULT_RESOLVED_KEYBINDINGS, {
    platform: "Linux x86_64",
  }).find((candidate) => candidate.title === "Approval");
  // The labels are the contract here; which chords they carry is the defaults' to say.
  expect(section?.rows.map((row) => row.label)).toEqual(["Approve", "Decline"]);
  expect(section?.rows.every((row) => row.keys.length === 1 && row.keys[0]!.length >= 2)).toBe(
    true,
  );
});
