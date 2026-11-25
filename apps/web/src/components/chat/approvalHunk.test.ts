import { describe, expect, it } from "vite-plus/test";

import { approvalHunkPreview, approvalPreviewFor } from "./approvalHunk";

const patch = [
  "diff --git a/src/math.ts b/src/math.ts",
  "--- a/src/math.ts",
  "+++ b/src/math.ts",
  "@@ -3,4 +3,6 @@ export function sum() {",
  " keep one",
  "-removed",
  "+added one",
  "+added two",
  " keep two",
  "\\ No newline at end of file",
  "@@ -40,2 +42,2 @@",
  "-second hunk",
  "+second hunk changed",
].join("\n");

describe("approvalHunkPreview", () => {
  it("numbers the first hunk by the file's own lines and stops at the next hunk", () => {
    expect(approvalHunkPreview(patch)).toEqual({
      lines: [
        { kind: "context", text: "keep one", number: 3 },
        { kind: "delete", text: "removed", number: 4 },
        { kind: "add", text: "added one", number: 4 },
        { kind: "add", text: "added two", number: 5 },
        { kind: "context", text: "keep two", number: 6 },
      ],
      hidden: 0,
    });
  });

  it("cuts a long hunk to the limit and says how much is left", () => {
    const long = ["@@ -1,12 +1,12 @@", ...Array.from({ length: 12 }, (_, i) => `+line ${i}`)].join(
      "\n",
    );
    const preview = approvalHunkPreview(long, 8)!;
    expect(preview.lines).toHaveLength(8);
    expect(preview.hidden).toBe(4);
  });

  it("has no preview for a patch without a hunk", () => {
    expect(approvalHunkPreview("Binary files a/x and b/x differ")).toBeNull();
    expect(approvalHunkPreview("")).toBeNull();
  });
});

describe("approvalPreviewFor", () => {
  const before = "export function sum(a: number, b: number) {\n  return a + b;\n}\n";
  const clamp =
    "\nexport function clamp(value: number, min: number, max: number) {\n  return Math.min(Math.max(value, min), max);\n}\n";

  it("uses the patch when the item has one", () => {
    const preview = approvalPreviewFor({ diffStr: patch, oldStr: "x", newStr: "y" })!;
    expect(preview.lines[1]).toEqual({ kind: "delete", text: "removed", number: 4 });
  });

  it("computes the first hunk from before and after text with a change in the middle", () => {
    const old = ["one", "two", "three", "four", "five", "six", "seven"].join("\n");
    const next = ["one", "two", "three", "FOUR", "five", "six", "seven"].join("\n");
    const preview = approvalPreviewFor({ oldStr: old, newStr: next })!;
    expect(preview.lines.find((line) => line.kind === "delete")).toEqual({
      kind: "delete",
      text: "four",
      number: 4,
    });
    expect(preview.lines.find((line) => line.kind === "add")).toEqual({
      kind: "add",
      text: "FOUR",
      number: 4,
    });
    expect(preview.lines.map((line) => line.kind)).toContain("context");
  });

  it("shows the lines added after existing code, numbered by the new file", () => {
    const preview = approvalPreviewFor({ oldStr: before, newStr: before + clamp })!;
    const added = preview.lines.filter((line) => line.kind === "add");
    expect(added.map((line) => line.text)).toEqual([
      "",
      "export function clamp(value: number, min: number, max: number) {",
      "  return Math.min(Math.max(value, min), max);",
      "}",
    ]);
    expect(added[1]!.number).toBe(5);
  });

  it("shows a new file's first lines as additions and counts the rest", () => {
    const text = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n");
    const preview = approvalPreviewFor({ oldStr: undefined, newStr: text })!;
    expect(preview.lines).toHaveLength(8);
    expect(preview.lines.every((line) => line.kind === "add")).toBe(true);
    expect(preview.lines[7]).toEqual({ kind: "add", text: "line 8", number: 8 });
    expect(preview.hidden).toBe(12);
  });

  it("shows a deleted file's first lines as removals", () => {
    const preview = approvalPreviewFor({ oldStr: "a\nb\nc\n", newStr: "" })!;
    expect(preview.lines).toEqual([
      { kind: "delete", text: "a", number: 1 },
      { kind: "delete", text: "b", number: 2 },
      { kind: "delete", text: "c", number: 3 },
    ]);
  });

  it("has nothing to show for identical text, and bails out above the size limit", () => {
    expect(approvalPreviewFor({ oldStr: before, newStr: before })).toBeNull();
    const big = "x".repeat(60_000);
    expect(approvalPreviewFor({ oldStr: big, newStr: `${big}y` })).toBeNull();
    expect(approvalPreviewFor({})).toBeNull();
  });
});
