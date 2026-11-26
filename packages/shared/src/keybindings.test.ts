import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_KEYBINDINGS } from "./keybindings.ts";

describe("approval keybindings", () => {
  it("binds Approve and Decline by default, on chords nothing else uses", () => {
    for (const command of ["approval.approve", "approval.decline"] as const) {
      const rules = DEFAULT_KEYBINDINGS.filter((rule) => rule.command === command);
      expect(rules, command).toHaveLength(1);
      const shared = DEFAULT_KEYBINDINGS.filter(
        (rule) => rule.key === rules[0]!.key && rule.command !== command,
      );
      expect(shared, `${command} shares ${rules[0]!.key}`).toEqual([]);
    }
  });
});
