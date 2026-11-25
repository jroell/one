import {
  MessageId,
  NodeId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderTurnId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { deriveMessagesTimelineRows } from "~/components/chat/MessagesTimeline.logic";
import { deriveTimelineEntriesFromVisibleTurnItems, type TimelineEntry } from "~/session-logic";
import { quietedLiveWorkIds } from "./chatQuietWork";

const runId = RunId.make("run");
const threadId = ThreadId.make("thread");
const at = (second: number) =>
  DateTime.makeUnsafe(`2026-10-06T10:00:${String(second).padStart(2, "0")}Z`);
const base = (id: string, second: number) => ({
  id: TurnItemId.make(id),
  threadId,
  runId,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: ProviderTurnId.make("provider-turn"),
  nativeItemRef: null,
  parentItemId: null,
  ordinal: second,
  title: null,
  startedAt: at(second),
  completedAt: at(second),
  updatedAt: at(second),
});

const userItem = (id: string, second: number): OrchestrationV2TurnItem => ({
  ...base(id, second),
  status: "completed",
  type: "user_message",
  messageId: MessageId.make(id),
  createdBy: "user",
  creationSource: "web",
  inputIntent: "turn_start",
  text: "Do the work",
  attachments: [],
});

const command = (
  id: string,
  second: number,
  fields: Partial<Extract<OrchestrationV2TurnItem, { type: "command_execution" }>> = {},
): OrchestrationV2TurnItem => ({
  ...base(id, second),
  status: "completed",
  type: "command_execution",
  input: `run ${id}`,
  ...fields,
});

const child = (id: string, second: number): OrchestrationV2TurnItem => ({
  ...base(id, second),
  status: "running",
  completedAt: null,
  type: "subagent",
  subagentId: NodeId.make(id),
  origin: "provider_native",
  driver: ProviderDriverKind.make("opencode"),
  providerInstanceId: ProviderInstanceId.make("opencode"),
  childThreadId: null,
  prompt: `Read ${id}`,
  result: null,
});

function entriesOf(items: ReadonlyArray<OrchestrationV2TurnItem>): TimelineEntry[] {
  return deriveTimelineEntriesFromVisibleTurnItems({
    visibleTurnItems: items.map((item) => ({
      position: item.ordinal,
      visibility: "local" as const,
      sourceThreadId: threadId,
      sourceItemId: item.id,
      item,
    })),
    optimisticMessages: [],
  });
}

const NONE = new Set<RuntimeRequestId>();
const quiet = (entries: ReadonlyArray<TimelineEntry>, pending = NONE) =>
  quietedLiveWorkIds(entries, pending);

describe("quietedLiveWorkIds", () => {
  it("quiets a running turn's passive work and keeps earlier turns", () => {
    const entries = entriesOf([
      command("earlier", 0),
      userItem("ask", 1),
      command("read", 2),
      {
        ...base("thought", 3),
        status: "completed",
        type: "reasoning",
        text: "Thinking",
        streaming: false,
      },
    ]);
    expect([...quiet(entries)]).toEqual([entries[2]!.id, entries[3]!.id]);
  });

  it("keeps a command that failed visible while the turn runs", () => {
    const entries = entriesOf([
      userItem("ask", 0),
      command("ok", 1),
      command("exit-one", 2, { exitCode: 1 }),
      command("rejected", 3, { status: "failed" }),
    ]);
    const quieted = quiet(entries);
    const byCommand = (name: string) =>
      entries.find((entry) => entry.kind === "work" && entry.entry.command === `run ${name}`)!;
    expect(quieted.has(byCommand("ok").id)).toBe(true);
    expect(quieted.has(byCommand("exit-one").id)).toBe(false);
    expect(quieted.has(byCommand("rejected").id)).toBe(false);
  });

  it("keeps a viewed image's source entry, so its image row survives", () => {
    const entries = entriesOf([
      userItem("ask", 0),
      {
        ...base("view", 1),
        status: "completed",
        type: "dynamic_tool",
        toolName: "view_image",
        viewedImagePath: "docs/diagram.png",
        input: {},
      },
    ]);
    expect(quiet(entries).size).toBe(0);
  });

  it("returns the same set for the same entries", () => {
    const entries = entriesOf([userItem("ask", 0), command("read", 1)]);
    expect(quiet(entries)).toBe(quiet(entries));
  });
});

describe("a running Chat turn's rows", () => {
  const rowsFor = (items: ReadonlyArray<OrchestrationV2TurnItem>, quieted: boolean) => {
    const timelineEntries = entriesOf(items);
    return deriveMessagesTimelineRows({
      timelineEntries,
      ...(quieted ? { quietedEntryIds: quiet(timelineEntries) } : {}),
      latestRun: {
        runId,
        status: "running",
        startedAt: DateTime.formatIso(at(0)),
        completedAt: null,
      },
      isWorking: true,
      activeTurnStartedAt: DateTime.formatIso(at(0)),
      turnDiffSummaries: [],
      supportsConversationRollback: false,
    });
  };
  const children = [
    userItem("ask", 0),
    child("a", 2),
    { ...child("b", 3), status: "completed" as const, completedAt: at(3) },
    child("c", 4),
  ];

  it("still waits on the subagents when nothing else has started", () => {
    const row = rowsFor(children, true).find((candidate) => candidate.kind === "thinking");
    expect(row).toMatchObject({ label: "Waiting on 2 subagents" });
  });

  it("does not claim to wait on the subagents once the parent starts a read", () => {
    const items = [...children, command("read", 5, { status: "running", completedAt: null })];
    const plain = rowsFor(items, false).find((candidate) => candidate.kind === "thinking");
    const quieted = rowsFor(items, true).find((candidate) => candidate.kind === "thinking");
    expect(plain?.label).toBeUndefined();
    expect(quieted?.label).toBeUndefined();
  });

  it("shows one status line, with no Thinking row or live tool row beside the working line", () => {
    const items = [userItem("ask", 0), command("read", 1)];
    expect(rowsFor(items, false).some((row) => row.kind === "work-live")).toBe(true);
    const kinds = rowsFor(items, true).map((row) => row.kind);
    expect(kinds).toContain("working");
    expect(kinds).not.toContain("thinking");
    expect(kinds).not.toContain("work-live");
  });

  it("shows a failed command as its own row while quieting the others", () => {
    const rows = rowsFor(
      [userItem("ask", 0), command("read", 1), command("broken", 2, { exitCode: 2 })],
      true,
    );
    expect(rows.map((row) => row.kind)).toEqual(["message", "working", "work"]);
    const shown = JSON.stringify(rows);
    expect(shown).toContain("run broken");
    expect(shown).not.toContain("run read");
  });
});
