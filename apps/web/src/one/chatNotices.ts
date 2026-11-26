import { createContext } from "react";

import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";
import type { WorkLogEntry } from "~/session-logic";

/** A notice from the run: a warning, a server that did not start, a fact. Not a failed turn. */
export function isNoticeEntry(entry: WorkLogEntry): boolean {
  return entry.itemType === "system_notice";
}

export interface ChatNoticeRowPlan {
  /** The notices this row's turn ends with, shown as one quiet line. Empty on an earlier row. */
  readonly notices: ReadonlyArray<WorkLogEntry>;
}

export const NO_CHAT_NOTICES: ReadonlyMap<string, ChatNoticeRowPlan> = new Map();

/** The notice plan for the rows on screen; empty outside Chat mode. */
export const ChatNoticePlanContext = createContext(NO_CHAT_NOTICES);

/**
 * Chat mode folds a turn's notices into one line at the end of the turn. Each activity row that
 * holds notices gets a plan: the last such row of a turn carries all of the turn's notices, and
 * an earlier one carries none, so its notices leave the row. Rows without notices have no plan.
 */
export function planChatNotices(
  rows: ReadonlyArray<MessagesTimelineRow>,
): ReadonlyMap<string, ChatNoticeRowPlan> {
  const plans = new Map<string, ChatNoticeRowPlan>();
  let turnRowIds: string[] = [];
  let turnNotices: WorkLogEntry[] = [];
  const closeTurn = () => {
    const last = turnRowIds.at(-1);
    for (const id of turnRowIds) {
      plans.set(id, { notices: id === last ? turnNotices : [] });
    }
    turnRowIds = [];
    turnNotices = [];
  };
  for (const row of rows) {
    if (row.kind === "message" && row.message.role === "user") {
      closeTurn();
      continue;
    }
    if (row.kind !== "work") continue;
    const notices = row.groupedEntries.filter(isNoticeEntry);
    if (notices.length === 0) continue;
    turnRowIds.push(row.id);
    turnNotices.push(...notices);
  }
  closeTurn();
  return plans.size === 0 ? NO_CHAT_NOTICES : plans;
}
