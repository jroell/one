import { describe, expect, it } from "vite-plus/test";

import { resolveUserMessagePresentation } from "@t3tools/client-runtime/user-message";

import {
  parseQuiz,
  quizBlockIndex,
  quizKey,
  quizScore,
  QUIZ_REQUEST,
  QUIZ_ROUND_REQUEST,
  withQuizInstructions,
} from "./chatQuiz";
import { m } from "~/i18n/messages";

const question = {
  question: "Why rings?",
  options: ["Looks", "Weight", "Cost"],
  correct: 1,
  explanation: "Less glass.",
};

describe("parseQuiz", () => {
  it("reads a block of questions, an array of them, and ignores fields it does not know", () => {
    const quiz = parseQuiz(
      JSON.stringify({ questions: [{ ...question, difficulty: "easy" }], x: 1 }),
    );
    expect(quiz?.questions).toEqual([question]);
    expect(parseQuiz(JSON.stringify([question]))?.questions).toEqual([question]);
  });

  it("keeps a question that has no explanation, with an empty one", () => {
    const { explanation: _explanation, ...bare } = question;
    expect(parseQuiz(JSON.stringify([bare]))?.questions[0]?.explanation).toBe("");
  });

  it("refuses a block that is still being written", () => {
    const whole = JSON.stringify({ questions: [question, question] });
    for (const cut of [10, 40, whole.length - 3]) {
      expect(parseQuiz(whole.slice(0, cut))).toBeNull();
    }
  });

  it("refuses a block with any question that cannot be asked", () => {
    const bad: Array<Record<string, unknown>> = [
      { ...question, question: " " },
      { ...question, options: ["Only one"] },
      { ...question, options: ["a", "b", "c", "d", "e"] },
      { ...question, options: ["a", "", "c"] },
      { ...question, correct: 3 },
      { ...question, correct: -1 },
      { ...question, correct: 1.5 },
      { ...question, correct: "1" },
      { ...question, explanation: 4 },
    ];
    for (const entry of bad) {
      expect(
        parseQuiz(JSON.stringify({ questions: [question, entry] })),
        JSON.stringify(entry),
      ).toBeNull();
    }
    expect(parseQuiz("{}")).toBeNull();
    expect(parseQuiz(JSON.stringify({ questions: [] }))).toBeNull();
    expect(parseQuiz("not json")).toBeNull();
    expect(parseQuiz("null")).toBeNull();
  });
});

describe("quizScore", () => {
  it("counts the questions whose pick is the right option", () => {
    const quiz = parseQuiz(JSON.stringify([question, question, question]))!;
    expect(quizScore(quiz, [1, 0, 1])).toBe(2);
    expect(quizScore(quiz, [null, null, null])).toBe(0);
  });
});

describe("quizKey and quizBlockIndex", () => {
  it("gives the first quiz of a message the message's own key and each later one its own", () => {
    expect(quizKey("m1", 0)).toBe("m1");
    expect(quizKey("m1", 1)).toBe("m1:1");
    expect(quizKey("m1", 2)).toBe("m1:2");
  });

  it("counts the quiz fences before a place in the text, in any fence form", () => {
    const text = [
      "Intro",
      "```quiz",
      "{}",
      "```",
      "",
      "~~~quiz",
      "{}",
      "~~~",
      "",
      "```js",
      "const quiz = 1;",
      "```",
      "",
      "   ```quiz",
      "{}",
      "   ```",
    ].join("\n");
    expect(quizBlockIndex(text, text.indexOf("```quiz"))).toBe(0);
    expect(quizBlockIndex(text, text.indexOf("~~~quiz"))).toBe(1);
    // A code fence that only mentions quiz in its code is not one.
    expect(quizBlockIndex(text, text.indexOf("   ```quiz"))).toBe(2);
    expect(quizBlockIndex(text, text.length)).toBe(3);
  });
});

describe("withQuizInstructions", () => {
  it("sends the reply's format with each of the two quiz requests, and the person reads only their own line", () => {
    for (const request of [m(QUIZ_REQUEST), m(QUIZ_ROUND_REQUEST)]) {
      const sent = withQuizInstructions(request);
      expect(sent).toContain("fenced code block labelled quiz");
      expect(sent).toContain('"questions"');
      expect(resolveUserMessagePresentation({ role: "user", text: sent }).text).toBe(request);
    }
  });

  it("sends anything else as written, even a request that only starts the same way", () => {
    for (const text of ["", "Quiz me", `${m(QUIZ_REQUEST)} About the rings.`, "Explain it again"]) {
      expect(withQuizInstructions(text)).toBe(text);
    }
  });
});
