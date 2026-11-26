import { useGT } from "gt-react";
import { CheckIcon, XIcon } from "lucide-react";
import { use, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import { Button, InlineButton } from "~/components/ui/button";

import { ChatFollowUpContext } from "./chatFollowUpTarget";
import { ChatEndHoldContext } from "./chatStage";
import {
  ChatQuizMessageContext,
  parseQuiz,
  quizScore,
  quizStem,
  readQuizPicks,
  writeQuizPicks,
  type Quiz,
} from "./chatQuiz";

/** Puts the quiz prompt in the composer, as the follow-up does, and moves there. */
function useAskForQuiz() {
  const gt = useGT();
  const { composerRef } = use(ChatFollowUpContext);
  if (composerRef === null) return null;
  return () => {
    const handle = composerRef.current;
    if (!handle) return;
    // Text already in the composer is the person's own: only take them there.
    const empty = handle.readSnapshot().value.trim().length === 0;
    if (empty && handle.insertTextAtEnd(quizStem(gt)) === false) return;
    handle.focusAtEnd();
  };
}

/**
 * A `quiz` fence in Chat mode. While it streams, or if it never turns out whole, the person never
 * sees its JSON: lines hold its place, then (if it cannot be read) one calm sentence.
 */
export function ChatQuizBlock({
  code,
  streaming,
}: {
  readonly code: string;
  readonly streaming: boolean;
}) {
  const messageId = use(ChatQuizMessageContext);
  const quiz = parseQuiz(code);
  if (streaming) return <ChatQuizPending />;
  if (quiz === null) return <ChatQuizUnreadable />;
  return <ChatQuiz key={messageId ?? "quiz"} quiz={quiz} messageId={messageId} />;
}

function ChatQuizPending() {
  const gt = useGT();
  return (
    <div className="one-chat-quiz-pending" role="status" aria-label={gt("Writing your questions")}>
      <div className="one-chat-stage-lines" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function ChatQuizUnreadable() {
  const gt = useGT();
  const ask = useAskForQuiz();
  return (
    <p className="one-chat-quiz-note" role="status">
      {gt("The quiz did not come out right.")}{" "}
      {ask ? <InlineButton onClick={ask}>{gt("Ask again")}</InlineButton> : null}
    </p>
  );
}

function firstOpen(picks: ReadonlyArray<number | null>, from = 0): number {
  const at = picks.findIndex((pick, index) => index >= from && pick === null);
  return at === -1 ? picks.length : at;
}

function ChatQuiz({ quiz, messageId }: { readonly quiz: Quiz; readonly messageId: string | null }) {
  const gt = useGT();
  const ask = useAskForQuiz();
  const holdEnd = use(ChatEndHoldContext);
  const [picks, setPicks] = useState<Array<number | null>>(
    () =>
      (messageId === null ? null : readQuizPicks(messageId, quiz)) ??
      quiz.questions.map(() => null),
  );
  // Reopening a thread shows the quiz where it was left: the first question still open, or the end.
  const [index, setIndex] = useState(() => firstOpen(picks));
  const nextRef = useRef<HTMLButtonElement>(null);
  // Set once the person has moved on themselves, so the next card takes focus and the keys go on.
  const advanced = useRef(false);
  const total = quiz.questions.length;
  const finished = index >= total;
  const question = finished ? undefined : quiz.questions[index];
  const picked = finished ? null : (picks[index] ?? null);
  const revealed = picked !== null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves focus to Next once the answer is revealed, so Enter goes on
  useEffect(() => {
    if (revealed) nextRef.current?.focus();
  }, [revealed]);

  const commit = (next: Array<number | null>) => {
    // The card is about to grow: the list must not scroll away from the question being read.
    holdEnd();
    setPicks(next);
    if (messageId !== null) writeQuizPicks(messageId, next);
  };
  const choose = (option: number) => {
    if (question === undefined || revealed || option >= question.options.length) return;
    commit(picks.map((pick, at) => (at === index ? option : pick)));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const digit = Number(event.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
      event.preventDefault();
      choose(digit - 1);
    }
  };

  if (finished) {
    const score = quizScore(quiz, picks);
    const missed = picks.flatMap((pick, at) => (pick === quiz.questions[at]!.correct ? [] : [at]));
    const radius = 26;
    const circumference = 2 * Math.PI * radius;
    return (
      <section className="one-chat-quiz" data-chat-quiz="" data-finished="" aria-label={gt("Quiz")}>
        <div className="one-chat-quiz-done">
          <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
            <circle cx="32" cy="32" r={radius} className="one-chat-quiz-ring-track" />
            <circle
              cx="32"
              cy="32"
              r={radius}
              className="one-chat-quiz-ring"
              style={
                {
                  strokeDasharray: `${(circumference * score) / total} ${circumference}`,
                  "--ring-len": (circumference * score) / total,
                } as CSSProperties
              }
            />
          </svg>
          <p className="one-chat-quiz-score" role="status">
            {gt("You got {score} of {total}.", { score: String(score), total: String(total) })}
          </p>
        </div>
        <div className="one-chat-quiz-actions">
          {missed.length > 0 ? (
            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                commit(picks.map((pick, at) => (missed.includes(at) ? null : pick)));
                advanced.current = true;
                setIndex(missed[0]!);
              }}
            >
              {gt("Go over the one you missed")}
            </Button>
          ) : null}
          {ask ? (
            <Button size="lg" onClick={ask}>
              {gt("Another round")}
            </Button>
          ) : null}
        </div>
      </section>
    );
  }

  const q = question!;
  const verdict = revealed
    ? picked === q.correct
      ? gt("Correct.")
      : gt("Not quite. The answer is {answer}.", { answer: q.options[q.correct]! })
    : "";
  return (
    <section
      className="one-chat-quiz"
      data-chat-quiz=""
      aria-label={gt("Quiz")}
      onKeyDown={onKeyDown}
    >
      <div
        key={index}
        // A card that arrives after the person moved on takes focus, so 1 to 4 and Enter keep working.
        ref={(card) => {
          if (card && advanced.current) {
            card.querySelector<HTMLElement>('[role="radio"]')?.focus();
          }
        }}
        className="one-chat-quiz-card"
      >
        <p className="one-chat-quiz-progress">
          {gt("Question {number} of {total}", { number: String(index + 1), total: String(total) })}
        </p>
        <h3 className="one-chat-quiz-question" id={`quiz-q-${messageId ?? "x"}-${index}`}>
          {q.question}
        </h3>
        <div
          role="radiogroup"
          aria-labelledby={`quiz-q-${messageId ?? "x"}-${index}`}
          className="one-chat-quiz-options"
        >
          {q.options.map((option, at) => {
            const state = !revealed
              ? "open"
              : at === q.correct
                ? "correct"
                : at === picked
                  ? "wrong"
                  : "dim";
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={picked === at}
                aria-disabled={revealed}
                className="one-chat-quiz-option"
                data-state={state}
                onClick={() => choose(at)}
              >
                <span className="one-chat-quiz-key" aria-hidden="true">
                  {at + 1}
                </span>
                <span className="one-chat-quiz-option-text">{option}</span>
                {state === "correct" ? (
                  <>
                    <CheckIcon aria-hidden className="one-chat-quiz-tick" />
                    <span className="sr-only">{gt("Correct answer")}</span>
                  </>
                ) : state === "wrong" ? (
                  <>
                    <XIcon aria-hidden className="one-chat-quiz-cross" />
                    <span className="sr-only">{gt("Your answer, not correct")}</span>
                  </>
                ) : null}
              </button>
            );
          })}
        </div>
        {revealed ? (
          <div className="one-chat-quiz-explain">
            {q.explanation.length > 0 ? <p>{q.explanation}</p> : null}
            <Button
              ref={nextRef}
              size="xl"
              onClick={() => {
                holdEnd();
                advanced.current = true;
                setIndex(firstOpen(picks, index + 1));
              }}
            >
              {index + 1 >= total || firstOpen(picks, index + 1) >= total
                ? gt("See how you did")
                : gt("Next")}
            </Button>
          </div>
        ) : null}
      </div>
      <p className="sr-only" role="status">
        {verdict}
      </p>
    </section>
  );
}
