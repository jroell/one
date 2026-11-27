import { describe, expect, it } from "vite-plus/test";

import { readAnswerEnding } from "./chatQuickReplies";

describe("readAnswerEnding", () => {
  it("offers yes, no and not sure when the answer ends by asking a yes-or-no question", () => {
    const text =
      "You have one Claude account signed in here, so Usage already shows its limits.\n\nDo you have a second account that is not signed in on this device?";
    expect(readAnswerEnding(text)).toEqual({ kind: "replies", replies: ["Yes", "No", "Not sure"] });
  });

  it("offers not sure and skip when it asks something that is not yes or no, and ignores emphasis around the question", () => {
    const text = "Both work for a team.\n\n**Which accounts do you want to see in one place?**";
    expect(readAnswerEnding(text)).toEqual({
      kind: "replies",
      replies: ["Not sure", "Skip that and give me your best recommendation."],
    });
    expect(readAnswerEnding("A hub pools accounts. **Do you run one?**")).toEqual({
      kind: "replies",
      replies: ["Yes", "No", "Not sure"],
    });
  });

  it("treats a question that offers a choice as open, so yes and no are not offered", () => {
    const text = "Both work.\n\nDo you want to add a hub or an HTTP source?";
    expect(readAnswerEnding(text)).toEqual({
      kind: "replies",
      replies: ["Not sure", "Skip that and give me your best recommendation."],
    });
  });

  it("offers nothing after a one-sentence answer and the follow-ups after a longer one that does not ask", () => {
    expect(readAnswerEnding("The command printed one JSON line.")).toEqual({ kind: "none" });
    expect(
      readAnswerEnding(
        "A hub pools several accounts. One address serves all of them. It needs a key.",
      ),
    ).toEqual({ kind: "follow-ups" });
  });

  it("does not take a question inside a code block or the middle of the answer for the ending", () => {
    const text = "Why does this fail? Because the key is missing. Add it, then run it again.";
    expect(readAnswerEnding(text)).toEqual({ kind: "follow-ups" });
  });
});
