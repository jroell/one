import { describe, expect, it } from "vite-plus/test";

import { toolOutputDisplayText } from "./toolOutputDisplay";

describe("toolOutputDisplayText", () => {
  it("returns real line breaks for serialized content blocks", () => {
    const wrapped = JSON.stringify([
      { type: "content", content: { type: "text", text: '{\n  "name": "demo"\n}' } },
    ]);
    expect(toolOutputDisplayText(wrapped)).toBe('{\n  "name": "demo"\n}');
  });

  it("joins several known text blocks", () => {
    const wrapped = JSON.stringify([
      { type: "text", text: "first" },
      { type: "content", content: { type: "text", text: "second" } },
    ]);
    expect(toolOutputDisplayText(wrapped)).toBe("first\nsecond");
  });

  it("keeps literal output exactly, including a JSON string literal such as an empty pair of quotes", () => {
    for (const output of [
      '""',
      '"a\\nb"',
      "plain text\nwith lines",
      '{"ok":true}',
      '[{"type":"image"}]',
      "[not json",
      "",
    ]) {
      expect(toolOutputDisplayText(output)).toBe(output);
    }
  });

  it("does not decode a block that carries fields beyond the known envelope", () => {
    const withAnnotations = JSON.stringify({
      type: "content",
      content: { type: "text", text: "hello", annotations: { audience: ["user"] } },
    });
    const withExtraTop = JSON.stringify([{ type: "text", text: "hello", id: 7 }]);
    expect(toolOutputDisplayText(withAnnotations)).toBe(withAnnotations);
    expect(toolOutputDisplayText(withExtraTop)).toBe(withExtraTop);
  });

  it("does not decode a list that mixes known blocks with anything else", () => {
    const mixed = JSON.stringify([
      { type: "text", text: "a" },
      { type: "image", data: "x" },
    ]);
    expect(toolOutputDisplayText(mixed)).toBe(mixed);
  });
});
