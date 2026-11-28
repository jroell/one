import { describe, expect, it } from "vite-plus/test";

import { settledMarkdown, speechChunks, speechSentences, spokenForm } from "./speechChunks";

describe("speechChunks", () => {
  it("splits text into sentences with the offset each starts at", () => {
    const text = "First one. Second one?\nThird!";
    expect(speechSentences(text)).toEqual([
      { text: "First one.", start: 0 },
      { text: "Second one?", start: 11 },
      { text: "Third!", start: 23 },
    ]);
  });

  it("does not end a sentence at a dot inside a number, file name or address", () => {
    expect(speechSentences("Version 1.2 of app.ts is at example.com today. Done.")).toEqual([
      { text: "Version 1.2 of app.ts is at example.com today.", start: 0 },
      { text: "Done.", start: 47 },
    ]);
  });

  it("joins short sentences so the voice does not pause after each one", () => {
    const text = "Yes. That works. I checked it twice and the build passes.";
    expect(speechChunks(text)).toEqual([{ text, start: 0 }]);
  });

  it("keeps the first sentence alone for a fetched voice, so reading starts sooner", () => {
    const chunks = speechChunks("Yes. That works. I checked it.", { firstAlone: true });
    expect(chunks.map((chunk) => chunk.text)).toEqual(["Yes.", "That works. I checked it."]);
  });

  it("never makes a chunk longer than 240 characters, breaking a long sentence at a comma or space", () => {
    const long = `${"word ".repeat(30).trim()}, ${"more ".repeat(40).trim()}.`;
    const chunks = speechChunks(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(240);
      expect(long.slice(chunk.start, chunk.start + chunk.text.length)).toBe(chunk.text);
    }
  });
});

describe("settledMarkdown", () => {
  it("reads whole lines and the finished sentences of the line still being written", () => {
    expect(settledMarkdown("First line.\nSecond is done. Third is not")).toBe(
      "First line.\nSecond is done.",
    );
    expect(settledMarkdown("One sentence. Another one sta")).toBe("One sentence.");
    expect(settledMarkdown("Light **bends**")).toBe("");
  });

  it("holds back a table at the end until a line after it arrives, since its spoken form counts its rows", () => {
    const table = "Here it is.\n| Name | Age |\n| --- | --- |\n| Ada | 36 |\n";
    expect(settledMarkdown(table)).toBe("Here it is.");
    expect(settledMarkdown(`${table}That is all.\n`)).toBe(`${table}That is all.`);
  });

  it("reads nothing from inside a code block that is still open, or a heading being typed", () => {
    expect(settledMarkdown("Run this.\n```sh\nnpm test. And more ")).toBe("Run this.\n```sh");
    expect(settledMarkdown("Intro.\n## Steps. First ")).toBe("Intro.");
  });
});

describe("spokenForm", () => {
  it("ends a line without punctuation with a stop, so list items are not run together", () => {
    expect(spokenForm("Reads the manifest\nAsks first\nDone.")).toBe(
      "Reads the manifest.\nAsks first.\nDone.",
    );
  });
});
