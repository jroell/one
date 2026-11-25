import { useGT } from "gt-react";

import { useComposerHandleContext } from "~/composerHandleContext";

/**
 * Three ways to carry an answer into the next thought. A pick puts a short stem in the composer
 * and focuses it. The row keeps its height while hidden, so the answer above never moves.
 */
export function ChatFollowUps({ ready }: { readonly ready: boolean }) {
  const gt = useGT();
  const composer = useComposerHandleContext();
  const actions = [
    { label: gt("Go deeper"), stem: gt("Go deeper on ") },
    {
      label: gt("Challenge this"),
      stem: gt("Challenge this: what is the strongest case against it?"),
    },
    { label: gt("Quiz me on this"), stem: gt("Quiz me on what you just explained.") },
  ];
  const follow = (stem: string) => {
    const handle = composer?.current;
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
          className="one-chip one-chat-followup"
          onClick={() => follow(action.stem)}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
