import { describe, expect, it } from "vite-plus/test";

import { toolOutputDisplayText } from "./toolOutputDisplay";

const typed = (output: string) => toolOutputDisplayText(output, "dynamic_tool");

describe("toolOutputDisplayText", () => {
  it("returns real line breaks for a dynamic tool's serialized content blocks", () => {
    const wrapped = JSON.stringify([
      { type: "content", content: { type: "text", text: '{\n  "name": "demo"\n}' } },
    ]);
    expect(typed(wrapped)).toBe('{\n  "name": "demo"\n}');
  });

  it("joins several known text blocks", () => {
    const wrapped = JSON.stringify([
      { type: "text", text: "first" },
      { type: "content", content: { type: "text", text: "second" } },
    ]);
    expect(typed(wrapped)).toBe("first\nsecond");
  });

  it("shows the same JSON text decoded for a dynamic tool and untouched for command output", () => {
    for (const printed of [
      '{"type":"text","text":""}',
      '{"type":"text","text":"hello"}',
      '[{"type":"content","content":{"type":"text","text":"a\\nb"}}]',
    ]) {
      expect(toolOutputDisplayText(printed, "command_execution")).toBe(printed);
      expect(typed(printed)).not.toBe(printed);
    }
    expect(typed('{"type":"text","text":""}')).toBe("");
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
      expect(typed(output)).toBe(output);
    }
  });

  it("does not decode a block that carries fields beyond the known envelope", () => {
    const withAnnotations = JSON.stringify({
      type: "content",
      content: { type: "text", text: "hello", annotations: { audience: ["user"] } },
    });
    const withExtraTop = JSON.stringify([{ type: "text", text: "hello", id: 7 }]);
    expect(typed(withAnnotations)).toBe(withAnnotations);
    expect(typed(withExtraTop)).toBe(withExtraTop);
  });

  it("does not decode a list that mixes known blocks with anything else", () => {
    const mixed = JSON.stringify([
      { type: "text", text: "a" },
      { type: "image", data: "x" },
    ]);
    expect(typed(mixed)).toBe(mixed);
  });
});
