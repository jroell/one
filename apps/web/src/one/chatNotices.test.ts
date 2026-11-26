import { describe, expect, it } from "vite-plus/test";

import type { MessagesTimelineRow } from "~/components/chat/MessagesTimeline.logic";
import type { WorkLogEntry } from "~/session-logic";
import { planChatNotices } from "./chatNotices";

const entry = (id: string, itemType?: string) =>
  ({ id, createdAt: "2026-01-01T00:00:00Z", label: id, tone: "tool", itemType }) as WorkLogEntry;
const workRow = (id: string, ...entries: WorkLogEntry[]) =>
  ({
    kind: "work",
    id,
    createdAt: "",
    groupedEntries: entries,
    isExpandedToolGroup: false,
  }) as MessagesTimelineRow;
const userRow = (id: string) =>
  ({ kind: "message", id, message: { role: "user", id } }) as unknown as MessagesTimelineRow;

describe("planChatNotices", () => {
  it("gives the last notice-bearing row of a turn every notice of that turn and earlier rows none", () => {
    const plan = planChatNotices([
      userRow("q1"),
      workRow("w1", entry("n1", "system_notice"), entry("tool", "command_execution")),
      workRow("w2", entry("n2", "system_notice")),
    ]);
    expect(plan.get("w1")?.notices).toEqual([]);
    expect(plan.get("w2")?.notices.map((notice) => notice.id)).toEqual(["n1", "n2"]);
  });

  it("keeps each turn's notices in that turn, and gives rows with no notice no plan", () => {
    const plan = planChatNotices([
      userRow("q1"),
      workRow("w1", entry("n1", "system_notice")),
      userRow("q2"),
      workRow("w2", entry("tool", "command_execution")),
      workRow("w3", entry("n2", "system_notice")),
    ]);
    expect(plan.get("w1")?.notices.map((notice) => notice.id)).toEqual(["n1"]);
    expect(plan.has("w2")).toBe(false);
    expect(plan.get("w3")?.notices.map((notice) => notice.id)).toEqual(["n2"]);
  });
});
