import { describe, expect, it } from "vite-plus/test";

import { parseQuiz, quizScore } from "./chatQuiz";

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
