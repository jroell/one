import { describe, expect, it } from "vite-plus/test";

const sources = import.meta.glob(["./*.ts", "./*.tsx", "!./*.test.*", "!./*.browser.*"], {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>;

// Timers and polling intervals are not animations; each entry names the file and why.
const NOT_ANIMATION = new Set([
  "./useComposerAnchor.ts",
  "./toast.queue.ts",
  "./toast.logic.ts",
  "./toast.tsx",
]);

const HARD_CODED_MOTION: ReadonlyArray<[string, RegExp]> = [
  ["a numbered duration utility (duration-200)", /\bduration-[1-9]\d*/],
  ["a numbered delay utility (delay-300)", /\bdelay-[1-9]\d*/],
  ["a named easing utility (ease-out)", /\bease-(?:in|out|in-out)\b/],
  ["a cubic-bezier", /cubic-bezier\(/],
  ["a millisecond duration in a transition or animation", /\b[1-9]\d*ms\b/],
];

describe("shared control motion source", () => {
  it("components/ui sets no duration, delay or easing by number or keyword; it reads the --mo-* and --ease-* tokens", () => {
    const found: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      if (NOT_ANIMATION.has(file)) continue;
      const code = text.replace(/\/\*[\s\S]*?\*\/|(?<![:"'`])\/\/.*$/gm, "");
      for (const [label, pattern] of HARD_CODED_MOTION) {
        const hit = pattern.exec(code);
        if (hit) found.push(`${file}: ${label}: "${hit[0]}"`);
      }
    }
    expect(found, "use duration-(--mo-quick), ease-(--ease-enter) or a var(--mo-*) value").toEqual(
      [],
    );
  });

  it("the scan reads the shared controls, so an empty glob cannot pass it", () => {
    expect(Object.keys(sources)).toEqual(
      expect.arrayContaining(["./button.tsx", "./menu.tsx", "./dialog-styles.ts", "./sheet.tsx"]),
    );
  });
});
