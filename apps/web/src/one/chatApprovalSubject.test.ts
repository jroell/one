import {
  MessageId,
  ProviderDriverKind,
  ProviderTurnId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { deriveTimelineEntriesFromVisibleTurnItems } from "~/session-logic";
import {
  deriveApprovalSubjects,
  isGenericFileChangePrompt,
  relativeToWorkspace,
  splitPathForEllipsis,
} from "./chatApprovalSubject";

const runId = RunId.make("run");
const threadId = ThreadId.make("thread");
const stamp = DateTime.makeUnsafe("2026-10-06T10:00:00Z");
const base = (id: string, ordinal: number) => ({
  id: TurnItemId.make(id),
  threadId,
  runId,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: ProviderTurnId.make("turn"),
  nativeItemRef: null,
  parentItemId: null,
  ordinal,
  title: null,
  startedAt: stamp,
  completedAt: stamp,
  updatedAt: stamp,
  status: "completed" as const,
});

function entriesOf(items: ReadonlyArray<OrchestrationV2TurnItem>) {
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

const nativeRef = (nativeId: string) => ({
  driver: ProviderDriverKind.make("codex"),
  nativeId,
  strength: "strong" as const,
});

const request = (
  kind: "file-change" | "command",
  id: RuntimeRequestId,
  ordinal: number,
  nativeId: string | null = "change",
) =>
  ({
    ...base(`approval-${ordinal}`, ordinal),
    nativeItemRef: nativeId === null ? null : nativeRef(nativeId),
    status: "waiting",
    type: "approval_request",
    requestId: id,
    requestKind: kind,
    prompt: "Changed files",
  }) satisfies OrchestrationV2TurnItem;

describe("deriveApprovalSubjects", () => {
  const pending = RuntimeRequestId.make("pending");
  const user = {
    ...base("ask", 0),
    type: "user_message",
    messageId: MessageId.make("ask"),
    createdBy: "user",
    creationSource: "web",
    inputIntent: "turn_start",
    text: "Edit it",
    attachments: [],
  } satisfies OrchestrationV2TurnItem;
  const change = {
    ...base("change", 1),
    nativeItemRef: nativeRef("change"),
    type: "file_change",
    fileName: "server/src/math.ts",
    additions: 12,
    deletions: 3,
    changes: [
      { operation: "update", path: "server/src/math.ts" },
      { operation: "update", path: "server/src/clamp.ts" },
    ],
  } satisfies OrchestrationV2TurnItem;

  it("names the file change with the same native item id as a pending file change request, with its counts", () => {
    const subjects = deriveApprovalSubjects(
      entriesOf([user, change, request("file-change", pending, 2)]),
      new Set([pending]),
    );
    expect(subjects.get(pending)).toMatchObject({
      path: "server/src/math.ts",
      moreFiles: 1,
      additions: 12,
      deletions: 3,
      diffStr: null,
    });
  });

  it("carries the matched change's own patch and the target that opens its diff, never another change's", () => {
    const patch = "@@ -1 +1 @@\n-old\n+new\n";
    const withPatch = { ...change, diffStr: patch } satisfies OrchestrationV2TurnItem;
    const subjects = deriveApprovalSubjects(
      entriesOf([user, withPatch, request("file-change", pending, 2)]),
      new Set([pending]),
    );
    const subject = subjects.get(pending)!;
    expect(subject.diffStr).toBe(patch);
    expect(subject.diffTarget).toMatchObject({
      itemId: withPatch.id,
      threadId: withPatch.threadId,
    });
    const second = RuntimeRequestId.make("second");
    const other = deriveApprovalSubjects(
      entriesOf([user, withPatch, request("file-change", second, 2, "second-change")]),
      new Set([second]),
    );
    expect(other.has(second)).toBe(false);
  });

  it("shows no subject for a second approval whose own file change has not arrived, instead of the earlier edit", () => {
    const second = RuntimeRequestId.make("second");
    const subjects = deriveApprovalSubjects(
      entriesOf([user, change, request("file-change", second, 2, "second-change")]),
      new Set([second]),
    );
    expect(subjects.has(second)).toBe(false);
  });

  it("matches each approval to its own file change when two file changes wait in one turn", () => {
    const second = RuntimeRequestId.make("second");
    const secondChange = {
      ...base("change-2", 3),
      nativeItemRef: nativeRef("second-change"),
      type: "file_change",
      fileName: "server/src/other.ts",
      additions: 1,
      deletions: 0,
      changes: [{ operation: "update", path: "server/src/other.ts" }],
    } satisfies OrchestrationV2TurnItem;
    const subjects = deriveApprovalSubjects(
      entriesOf([
        user,
        change,
        request("file-change", pending, 2),
        request("file-change", second, 4, "second-change"),
        secondChange,
      ]),
      new Set([pending, second]),
    );
    expect(subjects.get(pending)?.path).toBe("server/src/math.ts");
    expect(subjects.get(second)?.path).toBe("server/src/other.ts");
  });

  it("gives a command request, a settled request, and a request with no file change before it no subject", () => {
    const entries = entriesOf([user, change, request("command", pending, 2)]);
    expect(deriveApprovalSubjects(entries, new Set([pending])).size).toBe(0);
    expect(
      deriveApprovalSubjects(
        entriesOf([user, change, request("file-change", pending, 2)]),
        new Set(),
      ).size,
    ).toBe(0);
    expect(
      deriveApprovalSubjects(
        entriesOf([user, request("file-change", pending, 1)]),
        new Set([pending]),
      ).size,
    ).toBe(0);
  });
});

it("splits a path so the file name stays whole", () => {
  expect(splitPathForEllipsis("a/b/c.ts")).toEqual({ directory: "a/b/", name: "c.ts" });
  expect(splitPathForEllipsis("c.ts")).toEqual({ directory: "", name: "c.ts" });
});

it("treats a prompt that only restates the request as generic", () => {
  expect(isGenericFileChangePrompt("Changed files")).toBe(true);
  expect(isGenericFileChangePrompt(undefined)).toBe(true);
  expect(isGenericFileChangePrompt("Allow edits outside the workspace")).toBe(false);
});

it("shows a path below the workspace root without the root", () => {
  expect(relativeToWorkspace("/work/app/server/math.ts", "/work/app")).toBe("server/math.ts");
  expect(relativeToWorkspace("/elsewhere/math.ts", "/work/app")).toBe("/elsewhere/math.ts");
  expect(relativeToWorkspace("server/math.ts", undefined)).toBe("server/math.ts");
});
