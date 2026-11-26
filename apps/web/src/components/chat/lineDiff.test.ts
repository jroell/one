import { describe, expect, it } from "vite-plus/test";

import { firstHunkOfOps } from "./approvalHunk";
import { diffLines, splitLines } from "./lineDiff";

// A small deterministic generator, so a failing pair can be replayed from its index.
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomText(next: () => number): string {
  const count = Math.floor(next() * 9);
  const lines = Array.from({ length: count }, () => "abcd"[Math.floor(next() * 4)]!);
  const text = lines.join("\n");
  return text !== "" && next() < 0.7 ? `${text}\n` : text;
}

describe("diffLines", () => {
  it("turns the old lines into the new lines for random small pairs", () => {
    const next = random(7);
    for (let index = 0; index < 400; index += 1) {
      const before = splitLines(randomText(next));
      const after = splitLines(randomText(next));
      const ops = diffLines(before, after)!;
      const rebuiltAfter: string[] = [];
      const rebuiltBefore: string[] = [];
      for (const op of ops) {
        if (op.kind === "equal") {
          expect(before[op.oldIndex], `pair ${index}`).toBe(after[op.newIndex]);
          rebuiltAfter.push(after[op.newIndex]!);
          rebuiltBefore.push(before[op.oldIndex]!);
        } else if (op.kind === "insert") {
          rebuiltAfter.push(after[op.newIndex]!);
        } else {
          rebuiltBefore.push(before[op.oldIndex]!);
        }
      }
      expect(rebuiltAfter, `pair ${index}`).toEqual(after);
      expect(rebuiltBefore, `pair ${index}`).toEqual(before);
    }
  });

  it("shows a first hunk whose removals and additions turn its before range into its after range", () => {
    const next = random(11);
    for (let index = 0; index < 400; index += 1) {
      const beforeText = randomText(next);
      const afterText = randomText(next);
      const before = splitLines(beforeText);
      const after = splitLines(afterText);
      const ops = diffLines(before, after)!;
      const hunk = firstHunkOfOps(ops, before, after, { maxLines: 1000, numbered: true });
      if (beforeText === afterText) {
        expect(hunk, `pair ${index}`).toBeNull();
        continue;
      }
      const lines = hunk!.lines;
      const strip = (line: string) => line.replace(/\n$/, "");
      const firstChange = ops.findIndex((op) => op.kind !== "equal");
      const leadingContext = lines.findIndex((line) => line.kind !== "context");
      const start = firstChange - leadingContext;
      expect(lines[0]!.number, `pair ${index}`).toBe(start + 1);
      // Before the hunk the two texts are the same lines.
      expect(before.slice(0, start), `pair ${index}`).toEqual(after.slice(0, start));
      // The hunk's removals and context are the before range, and its additions and context are the
      // after range: removing the one and adding the other turns the first into the second.
      const oldRange = lines.filter((line) => line.kind !== "add");
      const newRange = lines.filter((line) => line.kind !== "delete");
      expect(
        oldRange.map((line) => line.text),
        `pair ${index}`,
      ).toEqual(before.slice(start, start + oldRange.length).map(strip));
      expect(
        newRange.map((line) => line.text),
        `pair ${index}`,
      ).toEqual(after.slice(start, start + newRange.length).map(strip));
    }
  });

  it("gives up rather than return an approximation when the texts differ by too many edits", () => {
    const before = Array.from({ length: 30 }, (_, index) => `old ${index}\n`);
    const after = Array.from({ length: 30 }, (_, index) => `new ${index}\n`);
    expect(diffLines(before, after, { maxEdits: 20 })).toBeNull();
    expect(diffLines(before, after, { maxEdits: 60 })).not.toBeNull();
    expect(diffLines(before, after, { maxLines: 10 })).toBeNull();
  });
});
