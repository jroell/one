import { describe, expect, it } from "vite-plus/test";

import { parseWorkspaceMode } from "./workspaceMode";

describe("stored workspace mode", () => {
  it("reads chat as chat", () => {
    expect(parseWorkspaceMode("chat")).toBe("chat");
  });

  it.each([null, "", "code", "voice", 3])("falls back to code for %j", (stored) => {
    expect(parseWorkspaceMode(stored)).toBe("code");
  });
});
