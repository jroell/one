import type { RuntimeRequestId } from "@t3tools/contracts";
import {
  workEntriesViewedImagePaths,
  workEntryDisplayIndicatesToolFailure,
} from "@t3tools/client-runtime/work-log/presentation";

import type { TimelineEntry } from "~/session-logic";
import {
  timelineEntryStartsResponse,
  workShownAsFinalAnswerOnly,
} from "~/components/chat/MessagesTimeline.logic";

// Tool activity that only narrates what the agent is doing. Anything else (an
// unknown work type, a pending question) stays, so new kinds of work show up
// until someone decides they are passive.
const PASSIVE_WORK_ITEM_TYPES: ReadonlySet<string> = new Set([
  "reasoning",
  "todo_list",
  "command_execution",
  "file_change",
  "file_search",
  "web_search",
  "dynamic_tool",
  "approval_request",
]);

function isQuietWork(entry: TimelineEntry, pendingApprovals: ReadonlySet<RuntimeRequestId>) {
  // Chat keeps more than the final-answer-only view: messages, subagent events and
  // plans always stay, so only work entries are candidates.
  if (entry.kind !== "work") return false;
  // The same checks the final-answer-only view keeps for: pending approvals, answered
  // questions, errors, compaction and the turn boundary.
  if (workShownAsFinalAnswerOnly(entry, pendingApprovals)) return false;
  const work = entry.entry;
  // A failed command or tool is the person's to see, and a viewed image is a result.
  if (workEntryDisplayIndicatesToolFailure(work)) return false;
  if (workEntriesViewedImagePaths([work]).length > 0) return false;
  return work.itemType !== undefined && PASSIVE_WORK_ITEM_TYPES.has(work.itemType);
}

const NO_ENTRIES: ReadonlySet<string> = new Set();

// The rows hook compares its input by content, but equal inputs should still return the same set.
const quietedByEntries = new WeakMap<
  ReadonlyArray<TimelineEntry>,
  { readonly pendingKey: string; readonly result: ReadonlySet<string> }
>();

/**
 * Chat mode while a turn runs: the ids of its passive work entries, whose rows give way to the
 * working line. Anything that needs the person stays, as do earlier turns and every non-work
 * entry. The entries themselves are not removed: the rows derive their tail state from all of them.
 */
export function quietedLiveWorkIds(
  entries: ReadonlyArray<TimelineEntry>,
  pendingApprovals: ReadonlySet<RuntimeRequestId>,
): ReadonlySet<string> {
  const pendingKey = [...pendingApprovals].sort().join("\0");
  const cached = quietedByEntries.get(entries);
  if (cached?.pendingKey === pendingKey) return cached.result;
  const liveFrom = entries.findLastIndex(timelineEntryStartsResponse) + 1;
  const ids = new Set<string>();
  for (let index = liveFrom; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (isQuietWork(entry, pendingApprovals)) ids.add(entry.id);
  }
  const result = ids.size === 0 ? NO_ENTRIES : ids;
  quietedByEntries.set(entries, { pendingKey, result });
  return result;
}
