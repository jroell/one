import { expect, it } from "vite-plus/test";

import { outlineLabel } from "./ChatOutline";

it.each([
  ["Teach me about attention\nand how deep to go", "Teach me about attention"],
  ["\n\n  ## A heading first  ", "A heading first"],
  ["- one\n- two", "one"],
  ["12. Numbered ask", "Numbered ask"],
  ["Spaces   inside\ttabs", "Spaces inside tabs"],
  ["   \n  ", null],
  ["", null],
  [null, null],
])("outline label for %j is %j", (text, label) => {
  expect(outlineLabel(text)).toBe(label);
});

it("outline label stops at 240 characters without splitting a surrogate pair", () => {
  const text = `${"a".repeat(239)}😀 and more`;
  expect(outlineLabel(text)).toBe("a".repeat(239));
});
