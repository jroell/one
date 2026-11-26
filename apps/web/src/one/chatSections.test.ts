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

  it("keeps a longer outer fence open through the shorter fences inside it", () => {
    const text = [
      "## Setup",
      "````markdown",
      "# Project",
      "```bash",
      "# install the dependencies",
      "```",
      "## still inside",
      "````",
      "## Next steps",
    ].join("\n");
    expect(parseChatHeadings(text, false)).toEqual(["Setup", "Next steps"]);
  });

  it("closes a tilde fence only with tildes, and a backtick fence only with backticks", () => {
    const tilde = ["~~~", "```", "# inside", "```", "# also inside", "~~~", "## After"].join("\n");
    expect(parseChatHeadings(tilde, false)).toEqual(["After"]);
    const tick = ["```", "~~~", "# inside", "~~~", "```", "## After"].join("\n");
    expect(parseChatHeadings(tick, false)).toEqual(["After"]);
  });

  it("does not close a fence with a shorter one, or with a line that has text after it", () => {
    const text = ["````", "```", "# inside", "```js", "# still inside", "````", "## After"].join(
      "\n",
    );
    expect(parseChatHeadings(text, false)).toEqual(["After"]);
  });

  it("opens a fence indented up to three spaces and not one indented four", () => {
    const indented = ["   ```bash", "   # a comment", "   ```", "## After"].join("\n");
    expect(parseChatHeadings(indented, false)).toEqual(["After"]);
    // Four spaces make an indented code block: no fence opens, so the next heading counts.
    const code = ["    ```", "## Real"].join("\n");
    expect(parseChatHeadings(code, false)).toEqual(["Real"]);
  });

  it("does not open a fence on a backtick line whose info string holds a backtick", () => {
    expect(parseChatHeadings("```js code```\n## Real", false)).toEqual(["Real"]);
  });

  it("keeps an unclosed fence open to the end of a streaming answer", () => {
    expect(parseChatHeadings("## One\n````md\n```\n## inside", true)).toEqual(["One"]);
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
