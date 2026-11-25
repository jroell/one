import { useGT } from "gt-react";
import { use } from "react";

import { formatWorkingTimerNow } from "~/components/chat/TimelineWorkGroupRows.logic";
import { TimelineRowCtx } from "~/components/chat/timelineRowContext";
import { tickTextContent } from "~/lib/tickTextContent";

import { OneMark } from "./OneMark";

/**
 * Chat mode's one status line while the turn waits on the person: it keeps the elapsed time
 * and holds the working mark still, since nothing is working.
 */
export function ChatWaitingLine({ since }: { readonly since: string | null }) {
  const gt = useGT();
  const { activeThreadEnvironmentId } = use(TimelineRowCtx);
  return (
    <div className="border-b border-border/60 pb-2 pt-1" data-chat-waiting>
      <div className="flex h-6 min-w-0 items-center gap-2 px-1 text-sm leading-relaxed text-muted-foreground tabular-nums">
        <span aria-hidden="true" className="one-working-mark">
          <OneMark className="size-5" />
        </span>
        <span className="shrink-0 whitespace-nowrap">{gt("Waiting for you")}</span>
        {since ? (
          <>
            <span aria-hidden="true">·</span>
            <span
              ref={tickTextContent(
                () => formatWorkingTimerNow(since, activeThreadEnvironmentId),
                true,
              )}
              className="tabular-nums"
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
