import { TurnItemId, RuntimeRequestId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { TimelineEntry } from "~/session-logic";
import { quietLiveWork } from "./chatQuietWork";

const AT = "2026-03-17T19:12:28.000Z";
const NONE = new Set<RuntimeRequestId>();

const userMessage = (id: string): TimelineEntry => ({
  id,
  kind: "message",
  createdAt: AT,
  message: {
    id: id as never,
    role: "user",
    text: id,
    runId: null,
    createdAt: AT,
    updatedAt: AT,
    streaming: false,
  },
});

function work(id: string, entry: Record<string, unknown>): TimelineEntry {
  return {
    id,
    kind: "work",
    createdAt: AT,
    entry: { id, createdAt: AT, label: id, tone: "tool", ...entry },
  } as TimelineEntry;
}

const approvalItem = (requestId: RuntimeRequestId) => ({
  item: { type: "approval_request", requestId, id: TurnItemId.make("approval"), runId: null },
});

describe("quietLiveWork", () => {
  const pendingId = RuntimeRequestId.make("pending");
  const entries = [
    work("old-read", { itemType: "dynamic_tool" }),
    userMessage("ask"),
    work("read", { itemType: "dynamic_tool" }),
    work("thought", { itemType: "reasoning", tone: "thinking" }),
    work("tasks", { itemType: "todo_list" }),
    work("pending-approval", {
      itemType: "approval_request",
      projectedItem: approvalItem(pendingId),
    }),
    work("settled-approval", {
      itemType: "approval_request",
      projectedItem: approvalItem(RuntimeRequestId.make("settled")),
    }),
    work("answered", { itemType: "user_input_request", questionAnswer: { answers: {} } }),
    work("failure", { itemType: "error", tone: "error" }),
    work("runtime-error", { itemType: "command_execution", sourceActivityKind: "runtime.error" }),
    work("compaction", { itemType: "compaction", sourceActivityKind: "context-compaction" }),
  ];
  const ids = (list: ReadonlyArray<TimelineEntry>) => list.map((entry) => entry.id);

  it("hides the running turn's passive work and keeps what needs the person", () => {
    expect(ids(quietLiveWork(entries, new Set([pendingId])))).toEqual([
      "old-read",
      "ask",
      "pending-approval",
      "answered",
      "failure",
      "runtime-error",
      "compaction",
    ]);
  });

  it("hides an approval request once it is no longer pending", () => {
    expect(ids(quietLiveWork(entries, NONE))).not.toContain("pending-approval");
  });

  it("returns the same array for the same entries, so the rows are not derived again", () => {
    expect(quietLiveWork(entries, new Set([pendingId]))).toBe(
      quietLiveWork(entries, new Set([pendingId])),
    );
    const untouched = [userMessage("ask")];
    expect(quietLiveWork(untouched, NONE)).toBe(untouched);
  });

  it("leaves a turn that already ended its own rows alone", () => {
    const earlier = [work("read", { itemType: "dynamic_tool" }), userMessage("ask")];
    expect(quietLiveWork(earlier, NONE)).toBe(earlier);
  });
});
