import type { RuntimeRequestId } from "@t3tools/contracts";

import type { TimelineEntry } from "~/session-logic";
import { timelineEntryStartsResponse } from "~/components/chat/MessagesTimeline.logic";

type WorkEntry = Extract<TimelineEntry, { kind: "work" }>;

// Tool activity that only narrates what the agent is doing. Everything else
// (compaction dividers, answered questions, errors, pending requests) stays.
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

function isPassiveWork(entry: WorkEntry, pendingApprovals: ReadonlySet<RuntimeRequestId>) {
  const work = entry.entry;
  const item = work.projectedItem?.item;
  if (item?.type === "approval_request" && pendingApprovals.has(item.requestId)) return false;
  if (work.questionAnswer !== undefined) return false;
  if (work.tone === "error" || work.sourceActivityKind === "runtime.error") return false;
  if (work.sourceActivityKind === "context-compaction") return false;
  return work.itemType !== undefined && PASSIVE_WORK_ITEM_TYPES.has(work.itemType);
}

// The rows hook compares its input by identity: equal inputs must return the same array.
const quietedByEntries = new WeakMap<
  ReadonlyArray<TimelineEntry>,
  { readonly pendingKey: string; readonly result: ReadonlyArray<TimelineEntry> }
>();

/**
 * Chat mode while a turn runs: its passive work gives way to the working line. Anything
 * that needs the person stays, as do earlier turns and every non-work entry.
 */
export function quietLiveWork(
  entries: ReadonlyArray<TimelineEntry>,
  pendingApprovals: ReadonlySet<RuntimeRequestId>,
): ReadonlyArray<TimelineEntry> {
  const pendingKey = [...pendingApprovals].sort().join("\0");
  const cached = quietedByEntries.get(entries);
  if (cached?.pendingKey === pendingKey) return cached.result;
  const liveFrom = entries.findLastIndex(timelineEntryStartsResponse) + 1;
  const kept = entries.filter(
    (entry, index) =>
      index < liveFrom || entry.kind !== "work" || !isPassiveWork(entry, pendingApprovals),
  );
  const result = kept.length === entries.length ? entries : kept;
  quietedByEntries.set(entries, { pendingKey, result });
  return result;
}
