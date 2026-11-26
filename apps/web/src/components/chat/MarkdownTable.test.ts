import { describe, expect, it } from "vite-plus/test";

import { markdownTableShape } from "./MarkdownTable";

const cell = (tagName: "th" | "td") => ({ type: "element", tagName, children: [] });
const row = (tagName: "th" | "td", columns: number) => ({
  type: "element",
  tagName: "tr",
  children: [{ type: "text" }, ...Array.from({ length: columns }, () => cell(tagName))],
});
const table = (bodyRows: number, columns: number) => ({
  type: "element",
  tagName: "table",
  children: [
    { type: "element", tagName: "thead", children: [row("th", columns)] },
    {
      type: "element",
      tagName: "tbody",
      children: Array.from({ length: bodyRows }, () => row("td", columns)),
    },
  ],
});

describe("markdownTableShape", () => {
  it("counts the body rows and the columns, leaving the header row and whitespace out", () => {
    expect(markdownTableShape(table(3, 4))).toEqual({ rows: 3, columns: 4 });
  });

  it("names no shape for a table with no body rows, or no node", () => {
    expect(markdownTableShape(table(0, 3))).toBeNull();
    expect(markdownTableShape(undefined)).toBeNull();
  });
});
