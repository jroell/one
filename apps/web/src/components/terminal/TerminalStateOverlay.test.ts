import { describe, expect, it } from "vite-plus/test";

import { displayTerminalCwd, terminalPhase } from "./TerminalStateOverlay";

describe("terminalPhase", () => {
  it("is starting until the session has delivered a running snapshot", () => {
    expect(terminalPhase({ status: "closed", error: null, version: 0 })).toBe("starting");
    expect(terminalPhase({ status: "starting", error: null, version: 3 })).toBe("starting");
    expect(terminalPhase({ status: "running", error: null, version: 1 })).toBe("ready");
  });

  it("reports an attach failure even while the grid still reads as closed", () => {
    expect(terminalPhase({ status: "error", error: null, version: 0 })).toBe("error");
    expect(terminalPhase({ status: "closed", error: "denied", version: 0 })).toBe("error");
  });
});

describe("displayTerminalCwd", () => {
  it("keeps the last two folders of a deep path and a short path whole", () => {
    expect(displayTerminalCwd("/Users/me/projects/one/apps/server/")).toBe("…/apps/server");
    expect(displayTerminalCwd("/repo")).toBe("/repo");
  });
});
