import { useGT } from "gt-react";
import { use, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { formatWorkingTimerNow } from "~/components/chat/TimelineWorkGroupRows.logic";
import { TimelineRowActivityCtx, TimelineRowCtx } from "~/components/chat/timelineRowContext";
import { tickTextContent } from "~/lib/tickTextContent";

import { ChatStageLayerContext, type ChatStage } from "./chatStage";
import { WorkingArc } from "./WorkingArc";

function StageBody({ stage }: { readonly stage: ChatStage }) {
  const gt = useGT();
  const { activeThreadEnvironmentId } = use(TimelineRowCtx);
  const { isPreparingWorktree } = use(TimelineRowActivityCtx);
  return (
    <>
      <div className="one-chat-stage-live">
        <WorkingArc size={32} />
        <span className="one-chat-stage-caption">
          {isPreparingWorktree ? gt("Getting ready") : gt("Thinking")}
          {stage.since ? (
            <>
              <span aria-hidden="true"> · </span>
              <span
                ref={tickTextContent(
                  () => formatWorkingTimerNow(stage.since!, activeThreadEnvironmentId),
                  true,
                )}
                className="tabular-nums"
              />
            </>
          ) : null}
        </span>
      </div>
    </>
  );
}

/**
 * The first seconds of a turn: the working arc under the person's own message, drawn only if no
 * answer has started after 250ms. When the answer starts, the stub keeps no room and
 * a ghost fades out on a layer over the timeline, because a row clips what leaves its own box.
 */
export function ChatStageBlock({ stage }: { readonly stage: ChatStage }) {
  const gt = useGT();
  const layer = use(ChatStageLayerContext);
  const stubRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  // Set when the entrance (after its delay) begins: a stage that never showed leaves no ghost.
  const [shown, setShown] = useState(false);
  const leaving = !stage.active;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- places the fading picture where the stage stood; only layout knows that
  useLayoutEffect(() => {
    const stub = stubRef.current;
    const ghost = ghostRef.current;
    if (!leaving || stub === null || ghost === null || layer === null) return;
    const from = stub.getBoundingClientRect();
    const to = layer.getBoundingClientRect();
    ghost.style.top = `${from.top - to.top}px`;
    ghost.style.left = `${from.left - to.left}px`;
    ghost.style.width = `${from.width}px`;
    ghost.style.visibility = "visible";
  }, [leaving, layer]);
  return (
    <div
      ref={stubRef}
      className="one-chat-stage"
      data-chat-stage=""
      data-leaving={leaving ? "" : undefined}
      data-shown={shown ? "" : undefined}
      role={leaving ? undefined : "status"}
      aria-label={leaving ? undefined : gt("Working on an answer")}
      onAnimationStart={(event) => {
        if (event.target === event.currentTarget) setShown(true);
      }}
    >
      {leaving ? null : <StageBody stage={stage} />}
      {leaving && shown && layer !== null
        ? createPortal(
            <div ref={ghostRef} className="one-chat-stage one-chat-stage-ghost" aria-hidden="true">
              <StageBody stage={stage} />
            </div>,
            layer,
          )
        : null}
    </div>
  );
}
