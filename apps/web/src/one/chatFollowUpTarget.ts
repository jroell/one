import { createContext } from "react";

import type { ComposerHandleRef } from "~/composerHandleContext";
import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";

/** Where the follow-up actions sit, and whether they may show yet. */
export interface ChatFollowUpTarget {
  /** The last row of the thread's final answer, or null when the thread does not end on one. */
  readonly rowId: string | null;
  readonly ready: boolean;
  /** The composer a pick writes to; the timeline's own, never an ancestor's. */
  readonly composerRef: ComposerHandleRef | null;
}

export const NO_FOLLOW_UP: ChatFollowUpTarget = { rowId: null, ready: false, composerRef: null };

export const ChatFollowUpContext = createContext<ChatFollowUpTarget>(NO_FOLLOW_UP);

/**
 * The row under which the follow-ups go: the last row of the final answer, when the thread's last
 * message is an assistant's. Older answers, and a thread that ends on the person's message, get none.
 * `ready` is false while the answer streams or anything waits on the person. Without a composer
 * to write to, no answer gets follow-ups.
 */
export function resolveChatFollowUpTarget(
  rows: ReadonlyArray<MessagesTimelineRow>,
  state: {
    readonly turnRunning: boolean;
    readonly awaitingPerson: boolean;
    readonly composerRef: ComposerHandleRef | null;
  },
): ChatFollowUpTarget {
  if (state.composerRef === null) return NO_FOLLOW_UP;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (row.kind !== "message" && row.kind !== "assistant-meta") continue;
    if (row.message.role === "system") continue;
    if (row.message.role !== "assistant") return NO_FOLLOW_UP;
    return {
      rowId: row.id,
      composerRef: state.composerRef,
      ready:
        !state.turnRunning &&
        !state.awaitingPerson &&
        !row.message.streaming &&
        row.message.text.trim().length > 0,
    };
  }
  return NO_FOLLOW_UP;
}
