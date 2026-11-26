import { useGT } from "gt-react";

import type { ComposerHandleRef } from "~/composerHandleContext";
import { m } from "~/i18n/messages";

import { QUIZ_REQUEST } from "./chatQuiz";
import { useAskForQuiz } from "./useAskForQuiz";

/**
 * Three ways to carry an answer into the next thought, most useful first. A pick puts a short stem
 * in the composer and focuses it; hovering or focusing one shows the words it will send. The block
 * takes no room until the turn ends.
 */
export function ChatFollowUps({
  ready,
  composer,
}: {
  readonly ready: boolean;
  readonly composer: ComposerHandleRef;
}) {
  const gt = useGT();
  const askForQuiz = useAskForQuiz("first");
  const actions = [
    {
      label: gt("Go deeper"),
      hint: gt("Take one part further"),
      stem: gt("Go deeper on "),
      preview: gt("Go deeper on …"),
    },
    {
      label: gt("Challenge this"),
      hint: gt("Argue the other side"),
      stem: gt("Challenge this: what is the strongest case against it?"),
      preview: gt("Challenge this: what is the strongest case against it?"),
    },
    {
      label: gt("Quiz me on this"),
      hint: gt("Check what stuck"),
      // Sent at once: the reply's format travels beside this line, out of sight.
      stem: null,
      preview: m(QUIZ_REQUEST),
    },
  ];
  const follow = (stem: string | null) => {
    if (stem === null) {
      askForQuiz();
      return;
    }
    const handle = composer.current;
    if (!handle) return;
    // Text already in the composer is the person's own: only take them there.
    const empty = handle.readSnapshot().value.trim().length === 0;
    if (empty && handle.insertTextAtEnd(stem) === false) return;
    handle.focusAtEnd();
  };
  return (
    <div
      className="one-chat-followups"
      role="group"
      aria-label={gt("Follow up")}
      data-ready={ready ? "" : undefined}
      inert={!ready}
    >
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          className="one-chat-followup"
          onClick={() => follow(action.stem)}
        >
          <span className="one-chat-followup-title">{action.label}</span>
          <span className="one-chat-followup-lines">
            <span className="one-chat-followup-hint">{action.hint}</span>
            <span className="one-chat-followup-preview" aria-hidden="true">
              {action.preview}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
