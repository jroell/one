import "~/index.css";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderTurnId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { AsyncResult, Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import {
  ApprovalSubjectContext,
  deriveApprovalSubjects,
  type ApprovalSubject,
} from "~/one/chatApprovalSubject";
import { deriveTimelineEntriesFromVisibleTurnItems } from "~/session-logic";
import type { PendingApproval } from "../../session-logic";
import { TimelinePendingApprovalRow } from "./TimelinePendingApprovalRow";
import { TimelineRowCtx } from "./timelineRowContext";

const requestId = RuntimeRequestId.make("request");
const patch = [
  "@@ -3,3 +3,4 @@",
  " keep",
  "-removed line",
  "+added line one",
  "+added line two",
].join("\n");

function approval(overrides: Partial<PendingApproval>): PendingApproval {
  return {
    requestId,
    requestKind: "file-change",
    createdAt: "2026-11-25T00:00:00Z",
    detail: "Changed files",
    responseCapability: "live",
    ...overrides,
  } as PendingApproval;
}

function row(pending: PendingApproval, subject: ApprovalSubject | null, onOpenToolDiff = vi.fn()) {
  const shared = {
    respondingRequestIds: [],
    canOperateThread: true,
    onRespondToApproval: async () => {},
    workspaceRoot: "/repo",
    onOpenToolDiff,
    activeThreadEnvironmentId: EnvironmentId.make("environment"),
    turnItemSource: { detail: () => Atom.make(AsyncResult.success({ item: null })) },
  } as never;
  return (
    <TimelineRowCtx value={shared}>
      <ApprovalSubjectContext value={new Map(subject ? [[requestId, subject]] : [])}>
        <TimelinePendingApprovalRow approval={pending} />
      </ApprovalSubjectContext>
    </TimelineRowCtx>
  );
}

const diffTarget = {
  threadId: ThreadId.make("thread"),
  itemId: TurnItemId.make("change"),
  revision: "r1",
};

it("shows the first hunk of the exact change being approved and opens its full diff", async () => {
  const onOpenToolDiff = vi.fn();
  await using screen = await render(
    row(
      approval({}),
      {
        path: "/repo/src/math.ts",
        moreFiles: 0,
        additions: 2,
        deletions: 1,
        diffStr: patch,
        diffTarget,
      },
      onOpenToolDiff,
    ),
    { router: false },
  );
  await expect.element(screen.getByText("Needs approval")).toBeVisible();
  await expect.element(screen.getByText("added line one")).toBeVisible();
  await expect.element(screen.getByText("removed line")).toBeVisible();
  expect(screen.container.querySelectorAll("[data-approval-hunk-lines] > div")).toHaveLength(4);
  await screen.getByRole("button", { name: "Show full diff" }).click();
  expect(onOpenToolDiff).toHaveBeenCalledWith(diffTarget);
});

it("shows the approval's own details when its change has not arrived, never a guess", async () => {
  await using screen = await render(
    row(approval({ requestKind: "command", detail: "rm -rf build && vp build" }), null),
    { router: false },
  );
  await expect.element(screen.getByText("rm -rf build && vp build")).toBeVisible();
  expect(screen.container.querySelector("[data-approval-hunk]")).toBeNull();
  await expect
    .element(screen.getByRole("button", { name: "Show full diff" }))
    .not.toBeInTheDocument();
});

it("shows the subject without a preview when the matched change carries no patch", async () => {
  await using screen = await render(
    row(approval({}), {
      path: "/repo/src/math.ts",
      moreFiles: 0,
      additions: 2,
      deletions: 1,
      diffStr: null,
      diffTarget,
    }),
    { router: false },
  );
  await expect.element(screen.getByText("src/math.ts")).toBeVisible();
  expect(screen.container.querySelector("[data-approval-hunk]")).toBeNull();
});

// The ACP sequence of the dev replay's showcase: a pending edit tool call carrying before and
// after text, then the permission request for the same call. The wire keeps no patch.
const SHOWCASE_OLD = "export function sum(a: number, b: number) {\n  return a + b;\n}\n";
const SHOWCASE_NEW = `${SHOWCASE_OLD}\nexport function clamp(value: number, min: number, max: number) {\n  return Math.min(Math.max(value, min), max);\n}\n`;

it("shows the added clamp lines for the replay's pending edit followed by its permission request", async () => {
  const threadId = ThreadId.make("replay-thread");
  const stamp = DateTime.makeUnsafe("2026-11-25T10:00:00Z");
  const base = (id: string, ordinal: number) => ({
    id: TurnItemId.make(id),
    threadId,
    runId: RunId.make("run"),
    nodeId: null,
    providerThreadId: null,
    providerTurnId: ProviderTurnId.make("turn"),
    nativeItemRef: {
      driver: ProviderDriverKind.make("acp"),
      nativeId: "showcase-edit",
      strength: "strong" as const,
    },
    parentItemId: null,
    ordinal,
    title: null,
    startedAt: stamp,
    completedAt: null,
    updatedAt: stamp,
    status: "waiting" as const,
  });
  const edit = {
    ...base("edit", 1),
    type: "file_change",
    fileName: "src/math.ts",
    changes: [{ operation: "update", path: "src/math.ts" }],
  } satisfies OrchestrationV2TurnItem;
  const permission = {
    ...base("permission", 2),
    type: "approval_request",
    requestId: requestId,
    requestKind: "file-change",
    prompt: "Edit src/math.ts",
  } satisfies OrchestrationV2TurnItem;
  const entries = deriveTimelineEntriesFromVisibleTurnItems({
    visibleTurnItems: [edit, permission].map((item) => ({
      position: item.ordinal,
      visibility: "local" as const,
      sourceThreadId: threadId,
      sourceItemId: item.id,
      item,
    })),
    optimisticMessages: [],
  });
  const subject = deriveApprovalSubjects(entries, new Set([requestId])).get(requestId)!;
  expect(subject.diffStr).toBeNull();

  const full = { ...edit, oldStr: SHOWCASE_OLD, newStr: SHOWCASE_NEW };
  const shared = {
    respondingRequestIds: [],
    canOperateThread: true,
    onRespondToApproval: async () => {},
    workspaceRoot: "/repo",
    onOpenToolDiff: vi.fn(),
    activeThreadEnvironmentId: EnvironmentId.make("environment"),
    turnItemSource: { detail: () => Atom.make(AsyncResult.success({ item: full })) },
  } as never;
  await using screen = await render(
    <TimelineRowCtx value={shared}>
      <ApprovalSubjectContext value={new Map([[requestId, subject]])}>
        <TimelinePendingApprovalRow approval={approval({})} />
      </ApprovalSubjectContext>
    </TimelineRowCtx>,
    { router: false },
  );
  await expect
    .element(screen.getByText("export function clamp(value: number, min: number, max: number) {"))
    .toBeVisible();
  const added = screen.container.querySelectorAll('[data-approval-hunk-lines] > [data-kind="add"]');
  expect(added.length).toBeGreaterThanOrEqual(3);
});
