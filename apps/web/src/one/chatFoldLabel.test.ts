import { describe, expect, it } from "vite-plus/test";

import { m } from "~/i18n/messages";
import { chatFoldLabel } from "./chatFoldLabel";

describe("chatFoldLabel", () => {
  const label = "Worked for 8s";

  it("names the tools that ran, with the time", () => {
    expect(
      chatFoldLabel({ label, summary: { duration: "8s", toolCount: 3, thought: true } }, m),
    ).toBe("Used 3 tools · 8s");
  });

  it("uses the singular for one tool and drops a time it does not have", () => {
    expect(
      chatFoldLabel({ label, summary: { duration: null, toolCount: 1, thought: false } }, m),
    ).toBe("Used 1 tool");
  });

  it("names a turn that only reasoned by how long it thought", () => {
    expect(
      chatFoldLabel({ label, summary: { duration: "4s", toolCount: 0, thought: true } }, m),
    ).toBe("Thought for 4s");
  });

  it("keeps the fold's own label when it has no summary, or the work was neither", () => {
    expect(chatFoldLabel({ label: "You stopped after 3s" }, m)).toBe("You stopped after 3s");
    expect(
      chatFoldLabel({ label, summary: { duration: "8s", toolCount: 0, thought: false } }, m),
    ).toBe(label);
  });
});
