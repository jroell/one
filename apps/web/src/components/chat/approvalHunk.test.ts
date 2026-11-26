import { describe, expect, it } from "vite-plus/test";

import {
  MAX_INPUT_CHARS,
  MAX_LINE_CHARS,
  approvalHunkPreview,
  approvalPreviewFor,
} from "./approvalHunk";

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

  it("cuts a single 130,000-character line", () => {
    const wide = ["@@ -1,2 +1,2 @@", " keep", `+${"x".repeat(130_000)}`].join("\n");
    const preview = approvalHunkPreview(wide)!;
    expect(preview.lines[1]!.text).toHaveLength(MAX_LINE_CHARS + 1);
    expect(preview.lines[1]!.text.endsWith("…")).toBe(true);
  });

  it("reads only the first part of an enormous patch and cannot count what it did not read", () => {
    const rows = Array.from({ length: 100_000 }, (_, index) => `+row ${index}`);
    const enormous = ["@@ -0,0 +1,100000 @@", ...rows].join("\n");
    const preview = approvalHunkPreview(enormous)!;
    expect(preview.lines).toHaveLength(8);
    expect(preview.hidden).toBeNull();
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

  it("shows recorded before and after text as an unnumbered excerpt, since its offset is unknown", () => {
    const old = ["one", "two", "three", "four", "five", "six", "seven"].join("\n");
    const next = ["one", "two", "three", "FOUR", "five", "six", "seven"].join("\n");
    const preview = approvalPreviewFor({ oldStr: old, newStr: next })!;
    expect(preview.lines.map((line) => [line.kind, line.text])).toEqual([
      ["context", "one"],
      ["context", "two"],
      ["context", "three"],
      ["delete", "four"],
      ["add", "FOUR"],
      ["context", "five"],
      ["context", "six"],
      ["context", "seven"],
    ]);
    expect(preview.lines.every((line) => line.number === null)).toBe(true);
  });

  it("shows lines added after existing code without numbering them from line 1", () => {
    const preview = approvalPreviewFor({ oldStr: before, newStr: before + clamp })!;
    const added = preview.lines.filter((line) => line.kind === "add");
    expect(added.map((line) => line.text)).toEqual([
      "",
      "export function clamp(value: number, min: number, max: number) {",
      "  return Math.min(Math.max(value, min), max);",
      "}",
    ]);
    expect(added.every((line) => line.number === null)).toBe(true);
  });

  it("numbers a new file's lines only when the change is recorded as an addition", () => {
    const text = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n");
    const preview = approvalPreviewFor({ oldStr: "", newStr: text, operation: "add" })!;
    expect(preview.lines).toHaveLength(8);
    expect(preview.lines.every((line) => line.kind === "add")).toBe(true);
    expect(preview.lines[7]).toEqual({ kind: "add", text: "line 8", number: 8 });
    expect(preview.hidden).toBe(12);
  });

  it("does not call one-sided recorded content an addition when nothing proves the file was empty", () => {
    const preview = approvalPreviewFor({ newStr: "alpha\nbeta\n" })!;
    expect(preview.lines).toEqual([
      { kind: "label", text: "recorded", number: null },
      { kind: "plain", text: "alpha", number: null },
      { kind: "plain", text: "beta", number: null },
    ]);
    expect(approvalPreviewFor({ oldStr: "gone\n" })!.lines[1]!.kind).toBe("plain");
  });

  it("shows a deleted file's first lines as removals when the change is recorded as a deletion", () => {
    const preview = approvalPreviewFor({ oldStr: "a\nb\nc\n", newStr: "", operation: "delete" })!;
    expect(preview.lines).toEqual([
      { kind: "delete", text: "a", number: 1 },
      { kind: "delete", text: "b", number: 2 },
      { kind: "delete", text: "c", number: 3 },
    ]);
  });

  it("has nothing to show for identical text, and bails out above the size limit", () => {
    expect(approvalPreviewFor({ oldStr: before, newStr: before })).toBeNull();
    const big = "x".repeat(MAX_INPUT_CHARS / 2 + 1);
    expect(approvalPreviewFor({ oldStr: big, newStr: `${big}y` })).toBeNull();
    expect(approvalPreviewFor({})).toBeNull();
  });

  it("shows labelled excerpts, never a diff, for two large and completely dissimilar texts", () => {
    const side = (tag: string) =>
      Array.from({ length: 4_000 }, (_, index) => `${tag} ${index} ${"q".repeat(10)}`).join("\n");
    const old = side("old");
    const next = side("new");
    expect(old.length + next.length).toBeLessThan(MAX_INPUT_CHARS);
    const preview = approvalPreviewFor({ oldStr: old, newStr: next })!;
    expect(preview.lines.map((line) => line.kind)).toEqual([
      "label",
      "plain",
      "plain",
      "plain",
      "label",
      "plain",
      "plain",
      "plain",
    ]);
    expect(preview.lines.map((line) => line.text)[0]).toBe("before");
    expect(preview.lines.map((line) => line.text)[4]).toBe("after");
    expect(preview.lines.some((line) => line.kind === "add" || line.kind === "delete")).toBe(false);
    expect(preview.lines[1]!.text).toBe(old.split("\n")[0]);
  });

  it("cuts one very long recorded line", () => {
    const preview = approvalPreviewFor({ oldStr: "a", newStr: "b".repeat(150_000) })!;
    expect(preview.lines.every((line) => line.text.length <= MAX_LINE_CHARS + 1)).toBe(true);
  });
});

describe("approvalPreviewFor shows a real diff", () => {
  const lines = (...rows: string[]) => `${rows.join("\n")}\n`;
  const kinds = (text: { oldStr: string; newStr: string }) =>
    approvalPreviewFor(text, 40)!.lines.map((line) => `${line.kind}:${line.text}`);

  it("keeps replacements at both ends separate from the unchanged lines between them", () => {
    const middle = Array.from({ length: 12 }, (_, index) => `same ${index}`);
    const preview = kinds({
      oldStr: lines("first old", ...middle, "last old"),
      newStr: lines("first new", ...middle, "last new"),
    });
    expect(preview.filter((row) => row.startsWith("delete:"))).toEqual(["delete:first old"]);
    expect(preview.filter((row) => row.startsWith("add:"))).toEqual(["add:first new"]);
    expect(preview).toContain("context:same 0");
    expect(preview.some((row) => row.startsWith("delete:same"))).toBe(false);
  });

  it("shows a moved line as one removal and one addition, not three", () => {
    expect(kinds({ oldStr: lines("a", "b", "c", "d"), newStr: lines("d", "a", "b", "c") })).toEqual(
      ["add:d", "context:a", "context:b", "context:c", "delete:d"],
    );
  });

  it("shows a change that is only the final newline", () => {
    const preview = approvalPreviewFor({ oldStr: "a\nb", newStr: "a\nb\n" })!;
    expect(preview.lines).toEqual([
      { kind: "context", text: "a", number: null },
      { kind: "delete", text: "b", number: null, noNewline: true },
      { kind: "add", text: "b", number: null },
    ]);
  });

  it("numbers a patch's hunk by the patch, and not the unchanged lines or another file's headers", () => {
    const two = [
      "diff --git a/one.ts b/one.ts",
      "--- a/one.ts",
      "+++ b/one.ts",
      "@@ -5,2 +5,2 @@",
      " keep",
      "-old one",
      "+new one",
      "diff --git a/two.ts b/two.ts",
      "--- a/two.ts",
      "+++ b/two.ts",
      "@@ -1 +1 @@",
      "-old two",
      "+new two",
    ].join("\n");
    const first = approvalHunkPreview(two)!;
    expect(first.lines).toEqual([
      { kind: "context", text: "keep", number: 5 },
      { kind: "delete", text: "old one", number: 6 },
      { kind: "add", text: "new one", number: 6 },
    ]);
    expect(first.hidden).toBe(0);
    expect(approvalHunkPreview(two, 8, "src/two.ts")!.lines).toEqual([
      { kind: "delete", text: "old two", number: 1 },
      { kind: "add", text: "new two", number: 1 },
    ]);
  });

  it("ends a hunk where its header's lengths say it ends, even when more plus lines follow", () => {
    const patch = ["@@ -1,1 +1,1 @@", "-a", "+b", "+++ b/next.ts", "+stray"].join("\n");
    expect(approvalHunkPreview(patch)!.lines.map((line) => line.text)).toEqual(["a", "b"]);
  });

  it("reads concatenated bare hunks as one hunk and ignores the second", () => {
    const patch = ["@@ -1 +1 @@", "-a", "+b", "@@ -9 +9 @@", "-c", "+d"].join("\n");
    expect(approvalHunkPreview(patch)!.lines.map((line) => line.text)).toEqual(["a", "b"]);
  });
});
