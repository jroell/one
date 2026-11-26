import { createContext } from "react";

/** One question of a quiz the reply carries in a fenced `quiz` block. */
export interface QuizQuestion {
  readonly question: string;
  readonly options: ReadonlyArray<string>;
  /** The index of the right option. */
  readonly correct: number;
  readonly explanation: string;
}

export interface Quiz {
  readonly questions: ReadonlyArray<QuizQuestion>;
}

/** The message whose quiz is on screen, so its picks are kept with it. */
export const ChatQuizMessageContext = createContext<string | null>(null);

const MAX_QUESTIONS = 8;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;
const MAX_TEXT = 600;

function text(value: unknown, limit = MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= limit ? trimmed : null;
}

function parseQuestion(value: unknown): QuizQuestion | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const question = text(record.question, 400);
  if (question === null || !Array.isArray(record.options)) return null;
  if (record.options.length < MIN_OPTIONS || record.options.length > MAX_OPTIONS) return null;
  const options = record.options.map((option) => text(option, 240));
  if (options.some((option) => option === null)) return null;
  const correct = record.correct;
  if (typeof correct !== "number" || !Number.isInteger(correct)) return null;
  if (correct < 0 || correct >= options.length) return null;
  const explanation = record.explanation === undefined ? "" : text(record.explanation);
  if (explanation === null) return null;
  return { question, options: options as string[], correct, explanation };
}

/**
 * A quiz from the text of a `quiz` fence: `{ "questions": [...] }` or the array itself. Every
 * question must be whole (a question, two to four options, the index of the right one, and an
 * explanation if it has one); one bad question makes the whole block invalid, so the person is
 * never quizzed on a half-made question. Extra fields are ignored.
 */
export function parseQuiz(source: string): Quiz | null {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return null;
  }
  const list = Array.isArray(value)
    ? value
    : typeof value === "object" && value !== null
      ? (value as Record<string, unknown>).questions
      : undefined;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_QUESTIONS) return null;
  const questions = list.map(parseQuestion);
  return questions.every((question) => question !== null)
    ? { questions: questions as QuizQuestion[] }
    : null;
}

/** The shape the prompt asks the reply to use, as one example. */
const QUIZ_SHAPE = JSON.stringify({
  questions: [{ question: "...", options: ["...", "...", "..."], correct: 0, explanation: "..." }],
});

export function quizScore(quiz: Quiz, picks: ReadonlyArray<number | null>): number {
  return quiz.questions.filter((question, index) => picks[index] === question.correct).length;
}

const storageKey = (messageId: string) => `one:quiz:${messageId}`;

/** The picks kept for a message, one per question; null when none fit this quiz. */
export function readQuizPicks(messageId: string, quiz: Quiz): Array<number | null> | null {
  try {
    const raw = window.localStorage.getItem(storageKey(messageId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== quiz.questions.length) return null;
    return parsed.map((pick, index) =>
      typeof pick === "number" &&
      Number.isInteger(pick) &&
      pick >= 0 &&
      pick < quiz.questions[index]!.options.length
        ? pick
        : null,
    );
  } catch {
    return null;
  }
}

export function writeQuizPicks(messageId: string, picks: ReadonlyArray<number | null>): void {
  try {
    window.localStorage.setItem(storageKey(messageId), JSON.stringify(picks));
  } catch {
    // Picks are a convenience: the quiz still works for this visit without them.
  }
}

/** The prompt that asks for a quiz: three questions, as one fenced block the reading view reads. */
export function quizStem(
  gt: (message: string, options?: Record<string, string>) => string,
): string {
  return gt(
    "Quiz me on what you just explained. Ask three questions. Reply with only a fenced code block labelled quiz that holds JSON in this shape: {shape}. Give three options for each question, the index of the right one as correct, and a sentence of explanation.",
    { shape: QUIZ_SHAPE },
  );
}
