import { describe, expect, it } from "vite-plus/test";

import { toolOutputDisplayText } from "./toolOutputDisplay";

describe("toolOutputDisplayText", () => {
  it("returns real line breaks for serialized content blocks", () => {
    const wrapped = JSON.stringify([
      { type: "content", content: { type: "text", text: '{\n  "name": "demo"\n}' } },
    ]);
    expect(toolOutputDisplayText(wrapped)).toBe('{\n  "name": "demo"\n}');
  });

  it("joins several text blocks and unwraps a JSON string literal", () => {
    const wrapped = JSON.stringify([
      { type: "text", text: "first" },
      { type: "content", content: { type: "text", text: "second" } },
    ]);
    expect(toolOutputDisplayText(wrapped)).toBe("first\nsecond");
    expect(toolOutputDisplayText(JSON.stringify("a\nb"))).toBe("a\nb");
  });

  it("leaves other output exactly as it arrived", () => {
    for (const output of [
      "plain text\nwith lines",
      '{"ok":true}',
      '[{"type":"image"}]',
      "[not json",
      "",
    ]) {
      expect(toolOutputDisplayText(output)).toBe(output);
    }
  });
});
