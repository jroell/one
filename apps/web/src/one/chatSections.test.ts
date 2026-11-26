import { describe, expect, it } from "vite-plus/test";

import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";
import { deriveChatSections, parseChatHeadings } from "./chatSections";

describe("parseChatHeadings", () => {
  it("lists the first three levels as plain text and skips code fences", () => {
    const text = [
      "# The **idea**",
      "text",
      "```md",
      "## not a heading",
      "```",
      "## A [link](http://x.test) and `code`",
      "#### too deep",
      "### Third",
    ].join("\n");
    expect(parseChatHeadings(text, false)).toEqual(["The idea", "A link and code", "Third"]);
  });

  it("holds back a heading whose line is still being typed while the answer streams", () => {
    expect(parseChatHeadings("## One\n\ntext\n\n## Tw", true)).toEqual(["One"]);
    expect(parseChatHeadings("## One\n\ntext\n\n## Tw", false)).toEqual(["One", "Tw"]);
    expect(parseChatHeadings("## One\n\ntext\n\n## Two\n", true)).toEqual(["One", "Two"]);
  });
});

function row(
  id: string,
  role: "user" | "assistant",
  text: string,
  streaming = false,
): MessagesTimelineRow {
  return {
    kind: "message",
    id: `row-${id}`,
    message: { id, role, text, streaming },
  } as unknown as MessagesTimelineRow;
}

describe("deriveChatSections", () => {
  it("files each answer's headings under its own turn and finishes a section when the next begins", () => {
    const sections = deriveChatSections([
      row("q1", "user", "First"),
      row("a1", "assistant", "## Alpha\n\ntext\n\n## Beta\n\nmore", true),
      row("q2", "user", "Second"),
      row("a2", "assistant", "No headings here."),
    ]);
    const first = sections.get("row-q1")!;
    expect(first.map((section) => [section.text, section.complete, section.rowIndex])).toEqual([
      ["Alpha", true, 1],
      ["Beta", false, 1],
    ]);
    expect(sections.has("row-q2")).toBe(false);
  });

  it("completes every section when the answer is done, and keeps ids stable while it streams", () => {
    const streaming = deriveChatSections([
      row("q1", "user", "First"),
      row("a1", "assistant", "## Alpha\n\ntext", true),
    ]).get("row-q1")!;
    const done = deriveChatSections([
      row("q1", "user", "First"),
      row("a1", "assistant", "## Alpha\n\ntext\n\n## Beta\n\nmore"),
    ]).get("row-q1")!;
    expect(streaming[0]!.id).toBe(done[0]!.id);
    expect(done.every((section) => section.complete)).toBe(true);
  });
});
