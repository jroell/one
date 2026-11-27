import { describe, expect, it } from "vite-plus/test";

import { m } from "~/i18n/messages";
import { chatFoldLabel } from "./chatFoldLabel";

describe("chatFoldLabel", () => {
  const label = "Worked for 8s";
  const summary = (toolCount: number, sourceCount: number, thought = false, duration = "8s") => ({
    label,
    summary: { duration: duration || null, toolCount, sourceCount, thought },
  });

  it("names work that only looked as sources, with the time", () => {
    expect(chatFoldLabel(summary(2, 2, true), m)).toBe("Looked at 2 sources · 8s");
  });

  it("uses the singular for one source and drops a time it does not have", () => {
    expect(chatFoldLabel(summary(1, 1, false, ""), m)).toBe("Looked at 1 source");
  });

  it("speaks of steps, never commands or files, for work that did something", () => {
    expect(chatFoldLabel(summary(3, 0), m)).toBe("Took 3 steps · 8s");
    expect(chatFoldLabel(summary(1, 0), m)).toBe("Took 1 step · 8s");
  });

  it("says both when the agent looked and then did something", () => {
    expect(chatFoldLabel(summary(3, 2), m)).toBe("Looked at 2 sources, took 1 step · 8s");
  });

  it("names a turn that only reasoned by how long it thought", () => {
    expect(chatFoldLabel(summary(0, 0, true, "4s"), m)).toBe("Thought for 4s");
  });

  it("keeps a stopped Chat turn's label when it has no summary", () => {
    expect(chatFoldLabel({ label: "You stopped after 3s" }, m)).toBe("You stopped after 3s");
  });

  it("calls unclassified Chat work Activity instead of showing a generic elapsed time", () => {
    expect(chatFoldLabel(summary(0, 0), m)).toBe("Activity");
  });
});
