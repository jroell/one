import { describe, expect, it } from "vite-plus/test";

import { clipAtWord } from "./titleEllipsis";

// Every character is 10px wide, so a width of 100 holds ten characters.
const measure = (text: string) => text.length * 10;

describe("clipping a title at a word boundary", () => {
  it("leaves a title that fits alone", () => {
    expect(clipAtWord("fix the build", 130, measure)).toBeNull();
  });

  it("ends before the word that would be cut, with room kept for the ellipsis", () => {
    const clipped = clipAtWord("switching a thread between default and managed", 200, measure);
    expect(clipped).toEqual({ head: "switching a thread", rest: " between default and managed" });
    expect(measure(`${clipped!.head}…`)).toBeLessThanOrEqual(200);
  });

  it("keeps the whole text in head and rest so the full title is still read", () => {
    const text = "fix(server): Antigravity 1.5.16 Google sign-ins stay in profile storage";
    const clipped = clipAtWord(text, 380, measure)!;
    expect(clipped.head + clipped.rest).toBe(text);
    expect(clipped.rest.startsWith(" ")).toBe(true);
  });

  it("takes the longest run of words that fits, not the first", () => {
    const clipped = clipAtWord("aa bb cc dd ee ff", 90, measure)!;
    // "aa bb cc" plus the ellipsis is 90px; one more word would not fit.
    expect(clipped.head).toBe("aa bb cc");
  });

  it("gives up when not even the first word fits, so the plain cut applies", () => {
    expect(clipAtWord("reallylongwordwithoutspaces and more", 60, measure)).toBeNull();
  });
});
